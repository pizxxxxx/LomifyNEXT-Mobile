#ifndef LOMIFY_IOS_AUDIO_H
#define LOMIFY_IOS_AUDIO_H
#include <stddef.h>
#include <stdint.h>

typedef struct LomifyDecoder LomifyDecoder;
LomifyDecoder *lomify_audio_open(const uint8_t *data, size_t size, char *error, size_t capacity);
void lomify_audio_close(LomifyDecoder *decoder);
int lomify_audio_channels(const LomifyDecoder *decoder);
int lomify_audio_sample_rate(const LomifyDecoder *decoder);
double lomify_audio_duration(const LomifyDecoder *decoder);
int lomify_audio_read(LomifyDecoder *decoder, float *samples, int capacity);
int lomify_audio_seek(LomifyDecoder *decoder, double seconds);
int lomify_audio_convert(const char *input, const char *output, char *error, size_t capacity);
int lomify_audio_export(const char *input, const char *output, const uint8_t *cover,
                        size_t cover_size, char *error, size_t capacity);
int64_t lomify_audio_probe(const char *path);
#endif
