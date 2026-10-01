/* FFmpeg library calls only. This file never launches a process. */
#include "ios_audio.h"
#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/mem.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>

struct LomifyDecoder {
    AVFormatContext *format;
    AVIOContext *io;
    AVCodecContext *codec;
    AVPacket *packet;
    AVFrame *frame;
    SwrContext *resampler;
    const uint8_t *data;
    size_t size, position;
    float *buffer;
    unsigned buffer_bytes;
    int buffered, offset, stream, flushing, finished;
    int channels, sample_rate;
    double duration, seek_target;
};

static int report(int code, const char *context, char *error, size_t capacity) {
    char reason[AV_ERROR_MAX_STRING_SIZE];
    av_strerror(code, reason, sizeof(reason));
    if (error && capacity) snprintf(error, capacity, "%s: %s", context, reason);
    return code;
}

static int memory_read(void *opaque, uint8_t *buffer, int size) {
    LomifyDecoder *d = opaque;
    size_t available = d->size - d->position;
    if (!available) return AVERROR_EOF;
    if ((size_t)size > available) size = (int)available;
    memcpy(buffer, d->data + d->position, size);
    d->position += size;
    return size;
}

static int64_t memory_seek(void *opaque, int64_t offset, int whence) {
    LomifyDecoder *d = opaque;
    if (whence & AVSEEK_SIZE) return (int64_t)d->size;
    whence &= ~AVSEEK_FORCE;
    int64_t base;
    switch (whence) {
        case SEEK_SET: base = 0; break;
        case SEEK_CUR: base = (int64_t)d->position; break;
        case SEEK_END: base = (int64_t)d->size; break;
        default: return AVERROR(EINVAL);
    }
    if ((offset > 0 && base > INT64_MAX - offset) ||
        (offset < 0 && offset < -base)) return AVERROR(EINVAL);
    int64_t position = base + offset;
    if (position < 0 || (uint64_t)position > d->size) return AVERROR(EINVAL);
    d->position = (size_t)position;
    return position;
}

void lomify_audio_close(LomifyDecoder *d) {
    if (!d) return;
    avformat_close_input(&d->format);
    if (d->io) {
        av_freep(&d->io->buffer);
        avio_context_free(&d->io);
    }
    avcodec_free_context(&d->codec);
    av_packet_free(&d->packet);
    av_frame_free(&d->frame);
    swr_free(&d->resampler);
    av_free(d->buffer);
    av_free(d);
}

static double format_duration(AVFormatContext *format, int stream) {
    AVStream *audio = format->streams[stream];
    if (audio->duration != AV_NOPTS_VALUE)
        return audio->duration * av_q2d(audio->time_base);
    if (format->duration != AV_NOPTS_VALUE)
        return (double)format->duration / AV_TIME_BASE;
    return -1;
}

static LomifyDecoder *decoder_open(const char *path, const uint8_t *data, size_t size,
                                   char *error, size_t capacity) {
    int result = AVERROR(ENOMEM);
    LomifyDecoder *d = av_mallocz(sizeof(*d));
    if (!d) { report(result, "allocate decoder", error, capacity); return NULL; }
    d->duration = -1;
    d->seek_target = -1;
    if (data) {
        if (!size || size > INT64_MAX) { result = AVERROR(EINVAL); goto fail; }
        d->data = data;
        d->size = size;
        d->format = avformat_alloc_context();
        uint8_t *io_buffer = av_malloc(32768);
        if (!d->format || !io_buffer) { av_free(io_buffer); goto fail; }
        d->io = avio_alloc_context(io_buffer, 32768, 0, d, memory_read, NULL, memory_seek);
        if (!d->io) { av_free(io_buffer); goto fail; }
        d->format->pb = d->io;
        d->format->flags |= AVFMT_FLAG_CUSTOM_IO;
    }
    result = avformat_open_input(&d->format, path, NULL, NULL);
    if (result < 0) goto fail;
    result = avformat_find_stream_info(d->format, NULL);
    if (result < 0) goto fail;
    const AVCodec *codec = NULL;
    result = av_find_best_stream(d->format, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0);
    if (result < 0) goto fail;
    d->stream = result;
    d->codec = avcodec_alloc_context3(codec);
    d->packet = av_packet_alloc();
    d->frame = av_frame_alloc();
    if (!d->codec || !d->packet || !d->frame) { result = AVERROR(ENOMEM); goto fail; }
    result = avcodec_parameters_to_context(d->codec, d->format->streams[d->stream]->codecpar);
    if (result < 0) goto fail;
    d->codec->thread_count = 1;
    result = avcodec_open2(d->codec, codec, NULL);
    if (result < 0) goto fail;
    d->channels = d->codec->ch_layout.nb_channels;
    d->sample_rate = d->codec->sample_rate;
    if (d->channels <= 0 || d->channels > 64 || d->sample_rate <= 0) {
        result = AVERROR_INVALIDDATA; goto fail;
    }
    d->duration = format_duration(d->format, d->stream);
    return d;
fail:
    report(result, "open audio", error, capacity);
    lomify_audio_close(d);
    return NULL;
}

LomifyDecoder *lomify_audio_open(const uint8_t *data, size_t size, char *error, size_t capacity) {
    if (!data) { report(AVERROR(EINVAL), "audio data", error, capacity); return NULL; }
    return decoder_open(NULL, data, size, error, capacity);
}
int lomify_audio_channels(const LomifyDecoder *d) { return d->channels; }
int lomify_audio_sample_rate(const LomifyDecoder *d) { return d->sample_rate; }
double lomify_audio_duration(const LomifyDecoder *d) { return d->duration; }

static int next_audio_frame(LomifyDecoder *d) {
    for (;;) {
        int result = avcodec_receive_frame(d->codec, d->frame);
        if (result == 0) return 1;
        if (result == AVERROR_EOF) return 0;
        if (result != AVERROR(EAGAIN)) return result;
        if (d->flushing) return AVERROR_INVALIDDATA;
        do {
            av_packet_unref(d->packet);
            result = av_read_frame(d->format, d->packet);
        } while (result >= 0 && d->packet->stream_index != d->stream);
        if (result == AVERROR_EOF) {
            d->flushing = 1;
            result = avcodec_send_packet(d->codec, NULL);
        } else if (result >= 0) {
            result = avcodec_send_packet(d->codec, d->packet);
        }
        av_packet_unref(d->packet);
        if (result < 0) return result;
    }
}

static int refill(LomifyDecoder *d) {
    if (d->finished) return 0;
    int result = next_audio_frame(d);
    if (result < 0) return result;
    if (!d->resampler && result) {
        AVChannelLayout output;
        av_channel_layout_default(&output, d->channels);
        result = swr_alloc_set_opts2(&d->resampler, &output, AV_SAMPLE_FMT_FLT,
                                    d->sample_rate, &d->frame->ch_layout,
                                    d->frame->format, d->frame->sample_rate, 0, NULL);
        av_channel_layout_uninit(&output);
        if (result < 0) return result;
        result = swr_init(d->resampler);
        if (result < 0) return result;
        result = 1;
    }
    int have_frame = result > 0;
    if (!d->resampler) { d->finished = 1; return 0; }
    int frame_size = have_frame ? d->frame->nb_samples : 0;
    int count = swr_get_out_samples(d->resampler, frame_size);
    if (count < 0) return count;
    if (count > INT_MAX / d->channels / (int)sizeof(float)) return AVERROR(ENOMEM);
    av_fast_malloc(&d->buffer, &d->buffer_bytes,
                   (size_t)(count + 1) * d->channels * sizeof(float));
    if (!d->buffer) return AVERROR(ENOMEM);
    uint8_t *output[] = {(uint8_t *)d->buffer};
    result = swr_convert(d->resampler, output, count,
                         have_frame ? (const uint8_t **)d->frame->extended_data : NULL,
                         frame_size);
    if (result < 0) return result;
    d->buffered = result * d->channels;
    d->offset = 0;
    if (have_frame && d->seek_target >= 0 && d->frame->best_effort_timestamp != AV_NOPTS_VALUE) {
        AVStream *stream = d->format->streams[d->stream];
        int64_t start = stream->start_time == AV_NOPTS_VALUE ? 0 : stream->start_time;
        double seconds = (d->frame->best_effort_timestamp - start) * av_q2d(stream->time_base);
        double skip = ceil((d->seek_target - seconds) * d->sample_rate);
        if (skip > 0) d->offset = (int)fmin(skip, result) * d->channels;
        if (d->offset < d->buffered) d->seek_target = -1;
    }
    av_frame_unref(d->frame);
    if (!have_frame && !result) d->finished = 1;
    return d->buffered - d->offset;
}

int lomify_audio_read(LomifyDecoder *d, float *samples, int capacity) {
    if (!d || !samples || capacity < d->channels) return AVERROR(EINVAL);
    capacity -= capacity % d->channels;
    int written = 0;
    while (written < capacity) {
        if (d->offset >= d->buffered) {
            int result = refill(d);
            if (result < 0) return result;
            if (!result) {
                if (d->finished) break;
                continue;
            }
        }
        int count = d->buffered - d->offset;
        if (count > capacity - written) count = capacity - written;
        memcpy(samples + written, d->buffer + d->offset, (size_t)count * sizeof(float));
        written += count;
        d->offset += count;
    }
    return written;
}

int lomify_audio_seek(LomifyDecoder *d, double seconds) {
    if (!d || !isfinite(seconds) || seconds < 0) return AVERROR(EINVAL);
    AVStream *stream = d->format->streams[d->stream];
    double units = seconds / av_q2d(stream->time_base);
    int64_t start = stream->start_time == AV_NOPTS_VALUE ? 0 : stream->start_time;
    if (units > (double)INT64_MAX - fmax(start, 0)) return AVERROR(EINVAL);
    int64_t timestamp = (int64_t)units + start;
    int result = avformat_seek_file(d->format, d->stream, INT64_MIN, timestamp, timestamp,
                                    AVSEEK_FLAG_BACKWARD);
    if (result < 0) return result;
    avcodec_flush_buffers(d->codec);
    swr_free(&d->resampler);
    av_packet_unref(d->packet);
    av_frame_unref(d->frame);
    d->buffered = d->offset = d->flushing = d->finished = 0;
    d->seek_target = seconds;
    return 0;
}

static int attach_cover(AVFormatContext *output, const uint8_t *data, size_t size, AVPacket **picture) {
    if (!size) return 0;
    if (!data || size > INT_MAX) return AVERROR(EINVAL);
    enum AVCodecID id;
    if (size >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff) id = AV_CODEC_ID_MJPEG;
    else if (size >= 8 && !memcmp(data, "\x89PNG\r\n\x1a\n", 8)) id = AV_CODEC_ID_PNG;
    else if (size >= 2 && !memcmp(data, "BM", 2)) id = AV_CODEC_ID_BMP;
    else return AVERROR_INVALIDDATA;
    const AVCodec *codec = avcodec_find_decoder(id);
    if (!codec) return AVERROR_DECODER_NOT_FOUND;
    AVCodecContext *context = avcodec_alloc_context3(codec);
    AVFrame *frame = av_frame_alloc();
    AVPacket *packet = av_packet_alloc();
    int result = AVERROR(ENOMEM);
    if (!codec || !context || !frame || !packet) goto done;
    result = av_new_packet(packet, (int)size);
    if (result < 0) goto done;
    memcpy(packet->data, data, size);
    result = avcodec_open2(context, codec, NULL);
    if (result < 0) goto done;
    result = avcodec_send_packet(context, packet);
    if (result < 0) goto done;
    result = avcodec_receive_frame(context, frame);
    if (result < 0) goto done;
    AVStream *stream = avformat_new_stream(output, NULL);
    if (!stream) { result = AVERROR(ENOMEM); goto done; }
    stream->time_base = (AVRational){1, 90000};
    stream->disposition = AV_DISPOSITION_ATTACHED_PIC;
    stream->codecpar->codec_type = AVMEDIA_TYPE_VIDEO;
    stream->codecpar->codec_id = id;
    stream->codecpar->width = frame->width;
    stream->codecpar->height = frame->height;
    packet->stream_index = stream->index;
    packet->pts = packet->dts = 0;
    packet->flags |= AV_PKT_FLAG_KEY;
    *picture = packet;
    packet = NULL;
    result = 0;
done:
    avcodec_free_context(&context);
    av_frame_free(&frame);
    av_packet_free(&packet);
    return result;
}

static void close_output(AVFormatContext **output) {
    if (!*output) return;
    if (!((*output)->oformat->flags & AVFMT_NOFILE)) avio_closep(&(*output)->pb);
    avformat_free_context(*output);
    *output = NULL;
}

static int output_header(AVFormatContext *output, const char *path, AVPacket *cover) {
    int result = avio_open(&output->pb, path, AVIO_FLAG_WRITE);
    if (result < 0) return result;
    AVDictionary *options = NULL;
    av_dict_set(&options, "movflags", "+faststart", 0);
    result = avformat_write_header(output, &options);
    av_dict_free(&options);
    if (result >= 0 && cover) result = av_interleaved_write_frame(output, cover);
    return result;
}

static int remux(const char *input, const char *path, const uint8_t *cover, size_t cover_size) {
    AVFormatContext *source = NULL, *output = NULL;
    AVPacket *packet = NULL, *picture = NULL;
    int result = avformat_open_input(&source, input, NULL, NULL);
    if (result < 0) goto done;
    result = avformat_find_stream_info(source, NULL);
    if (result < 0) goto done;
    int index = av_find_best_stream(source, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    if (index < 0) { result = index; goto done; }
    AVStream *audio = source->streams[index];
    if (audio->codecpar->codec_id != AV_CODEC_ID_AAC) { result = AVERROR(EINVAL); goto done; }
    result = avformat_alloc_output_context2(&output, NULL, "ipod", path);
    if (result < 0) goto done;
    AVStream *target = avformat_new_stream(output, NULL);
    if (!target) { result = AVERROR(ENOMEM); goto done; }
    result = avcodec_parameters_copy(target->codecpar, audio->codecpar);
    if (result < 0) goto done;
    target->codecpar->codec_tag = 0;
    target->time_base = audio->time_base;
    av_dict_copy(&output->metadata, source->metadata, 0);
    result = attach_cover(output, cover, cover_size, &picture);
    if (result < 0) goto done;
    result = output_header(output, path, picture);
    if (result < 0) goto done;
    packet = av_packet_alloc();
    if (!packet) { result = AVERROR(ENOMEM); goto done; }
    while ((result = av_read_frame(source, packet)) >= 0) {
        if (packet->stream_index == index) {
            av_packet_rescale_ts(packet, audio->time_base, target->time_base);
            packet->stream_index = target->index;
            packet->pos = -1;
            result = av_interleaved_write_frame(output, packet);
        }
        av_packet_unref(packet);
        if (result < 0) goto done;
    }
    if (result == AVERROR_EOF) result = av_write_trailer(output);
done:
    av_packet_free(&packet);
    av_packet_free(&picture);
    avformat_close_input(&source);
    close_output(&output);
    return result;
}

static int write_encoded(AVCodecContext *encoder, AVFormatContext *output, AVStream *stream,
                          AVFrame *frame, AVPacket *packet) {
    int result = avcodec_send_frame(encoder, frame);
    if (result < 0) return result;
    while ((result = avcodec_receive_packet(encoder, packet)) >= 0) {
        av_packet_rescale_ts(packet, encoder->time_base, stream->time_base);
        packet->stream_index = stream->index;
        packet->pos = -1;
        result = av_interleaved_write_frame(output, packet);
        av_packet_unref(packet);
        if (result < 0) return result;
    }
    return result == AVERROR(EAGAIN) || result == AVERROR_EOF ? 0 : result;
}

static int encode_aac(const char *input, const char *path) {
    LomifyDecoder *source = decoder_open(input, NULL, 0, NULL, 0);
    AVFormatContext *output = NULL;
    AVCodecContext *encoder = NULL;
    AVFrame *frame = NULL;
    AVPacket *packet = NULL;
    float *samples = NULL;
    int result = AVERROR_INVALIDDATA;
    if (!source) goto done;
    const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_AAC);
    if (!codec) { result = AVERROR_ENCODER_NOT_FOUND; goto done; }
    encoder = avcodec_alloc_context3(codec);
    if (!encoder) { result = AVERROR(ENOMEM); goto done; }
    const int *rates = NULL;
    int rate_count = 0;
    result = avcodec_get_supported_config(NULL, codec, AV_CODEC_CONFIG_SAMPLE_RATE,
                                         0, (const void **)&rates, &rate_count);
    if (result < 0) goto done;
    int rate = source->sample_rate;
    if (rates && rate_count) {
        rate = rates[0];
        for (int i = 1; i < rate_count; i++)
            if (abs(rates[i] - source->sample_rate) < abs(rate - source->sample_rate)) rate = rates[i];
    }
    encoder->sample_rate = source->sample_rate = rate;
    encoder->sample_fmt = AV_SAMPLE_FMT_FLTP;
    encoder->bit_rate = 256000;
    encoder->time_base = (AVRational){1, rate};
    av_channel_layout_default(&encoder->ch_layout, source->channels);
    result = avformat_alloc_output_context2(&output, NULL, "ipod", path);
    if (result < 0) goto done;
    if (output->oformat->flags & AVFMT_GLOBALHEADER) encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    result = avcodec_open2(encoder, codec, NULL);
    if (result < 0) goto done;
    AVStream *stream = avformat_new_stream(output, NULL);
    if (!stream) { result = AVERROR(ENOMEM); goto done; }
    stream->time_base = encoder->time_base;
    result = avcodec_parameters_from_context(stream->codecpar, encoder);
    if (result < 0) goto done;
    av_dict_copy(&output->metadata, source->format->metadata, 0);
    result = output_header(output, path, NULL);
    if (result < 0) goto done;
    frame = av_frame_alloc();
    packet = av_packet_alloc();
    int frame_size = encoder->frame_size;
    if (!frame || !packet || frame_size <= 0) { result = AVERROR(ENOMEM); goto done; }
    frame->format = encoder->sample_fmt;
    frame->sample_rate = rate;
    frame->nb_samples = frame_size;
    result = av_channel_layout_copy(&frame->ch_layout, &encoder->ch_layout);
    if (result < 0) goto done;
    result = av_frame_get_buffer(frame, 0);
    if (result < 0) goto done;
    samples = av_malloc_array(frame_size, (size_t)source->channels * sizeof(float));
    if (!samples) { result = AVERROR(ENOMEM); goto done; }
    int64_t position = 0;
    for (;;) {
        int count = lomify_audio_read(source, samples, frame_size * source->channels);
        if (count < 0) { result = count; goto done; }
        if (!count) break;
        frame->nb_samples = frame_size;
        result = av_frame_make_writable(frame);
        if (result < 0) goto done;
        frame->nb_samples = count / source->channels;
        for (int ch = 0; ch < source->channels; ch++) {
            float *channel = (float *)frame->extended_data[ch];
            for (int i = 0; i < frame->nb_samples; i++) channel[i] = samples[i * source->channels + ch];
        }
        frame->pts = position;
        position += frame->nb_samples;
        result = write_encoded(encoder, output, stream, frame, packet);
        if (result < 0) goto done;
    }
    result = write_encoded(encoder, output, stream, NULL, packet);
    if (result >= 0) result = av_write_trailer(output);
done:
    av_free(samples);
    av_frame_free(&frame);
    av_packet_free(&packet);
    avcodec_free_context(&encoder);
    close_output(&output);
    lomify_audio_close(source);
    return result;
}

int lomify_audio_convert(const char *input, const char *output, char *error, size_t capacity) {
    int result = remux(input, output, NULL, 0);
    if (result < 0) result = encode_aac(input, output);
    return result < 0 ? report(result, "convert to M4A", error, capacity) : 0;
}

int lomify_audio_export(const char *input, const char *output, const uint8_t *cover,
                        size_t cover_size, char *error, size_t capacity) {
    int result = remux(input, output, cover, cover_size);
    return result < 0 ? report(result, "export M4A", error, capacity) : 0;
}

int64_t lomify_audio_probe(const char *path) {
    AVFormatContext *format = NULL;
    int64_t duration = -1;
    if (avformat_open_input(&format, path, NULL, NULL) >= 0 &&
        avformat_find_stream_info(format, NULL) >= 0) {
        int stream = av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
        if (stream >= 0) {
            double seconds = format_duration(format, stream);
            if (isfinite(seconds) && seconds >= 0 && seconds < (double)INT64_MAX / 1000)
                duration = (int64_t)llround(seconds * 1000);
        }
    }
    avformat_close_input(&format);
    return duration;
}
