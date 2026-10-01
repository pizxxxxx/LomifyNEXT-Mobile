#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <UIKit/UIKit.h>
#include <stdint.h>

typedef int32_t (*LomifyMediaAction)(int32_t, double);
static NSMutableDictionary *nowPlaying;
static NSUInteger artworkGeneration;
static NSArray *observers;

void lomify_media_initialize(LomifyMediaAction action) {
    NSCAssert(NSThread.isMainThread, @"Media setup must run on the main thread");
    MPRemoteCommandCenter *commands = MPRemoteCommandCenter.sharedCommandCenter;
    NSArray<MPRemoteCommand *> *simple = @[commands.playCommand, commands.pauseCommand,
        commands.togglePlayPauseCommand, commands.nextTrackCommand, commands.previousTrackCommand];
    for (NSUInteger index = 0; index < simple.count; index++) {
        MPRemoteCommand *command = simple[index];
        command.enabled = YES;
        [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            (void)event;
            return action((int32_t)index, 0) ? MPRemoteCommandHandlerStatusSuccess : MPRemoteCommandHandlerStatusCommandFailed;
        }];
    }
    commands.changePlaybackPositionCommand.enabled = YES;
    [commands.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        double position = ((MPChangePlaybackPositionCommandEvent *)event).positionTime;
        return action(5, position) ? MPRemoteCommandHandlerStatusSuccess : MPRemoteCommandHandlerStatusCommandFailed;
    }];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    NSMutableArray *tokens = [NSMutableArray new];
    if (@available(iOS 27.0, *)) {
        [tokens addObject:[center addObserverForName:AVAudioSessionDidBecomeInactiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            AVAudioSessionDeactivationContext *context = note.userInfo[AVAudioSessionDeactivationContextKey];
            if (context.interruptionContext) action(6, 0);
        }]];
        [tokens addObject:[center addObserverForName:AVAudioSessionResumptionRecommendationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            AVAudioSessionResumptionContext *context = note.userInfo[AVAudioSessionResumptionContextKey];
            action(7, context.recommendation == AVAudioSessionResumptionRecommendationShouldResume);
        }]];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [tokens addObject:[center addObserverForName:AVAudioSessionInterruptionNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            NSInteger type = [note.userInfo[AVAudioSessionInterruptionTypeKey] integerValue];
            if (type == AVAudioSessionInterruptionTypeBegan) action(6, 0);
            else action(7, ([note.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue] & AVAudioSessionInterruptionOptionShouldResume) != 0);
        }]];
#pragma clang diagnostic pop
    }
    id background = [center addObserverForName:UIApplicationDidEnterBackgroundNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { (void)note; action(8, 0); }];
    id foreground = [center addObserverForName:UIApplicationWillEnterForegroundNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { (void)note; action(9, 0); }];
    id route = [center addObserverForName:AVAudioSessionRouteChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        if ([note.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue] == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) action(10, 0);
    }];
    [tokens addObjectsFromArray:@[background, foreground, route]];
    observers = tokens;
}

void lomify_media_metadata(const char *title, const char *artist, const char *cover, double duration) {
    @autoreleasepool {
        NSString *name = [NSString stringWithUTF8String:title] ?: @"";
        NSString *performer = [NSString stringWithUTF8String:artist] ?: @"";
        NSString *artwork = cover ? [NSString stringWithUTF8String:cover] : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            nowPlaying = [NSMutableDictionary dictionaryWithDictionary:@{
                MPMediaItemPropertyTitle:name, MPMediaItemPropertyArtist:performer,
                MPMediaItemPropertyPlaybackDuration:@(duration),
                MPNowPlayingInfoPropertyElapsedPlaybackTime:@0, MPNowPlayingInfoPropertyPlaybackRate:@0,
                MPNowPlayingInfoPropertyMediaType:@(MPNowPlayingInfoMediaTypeAudio)}];
            MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nowPlaying;
            NSUInteger generation = ++artworkGeneration;
            NSURL *url = artwork ? [NSURL URLWithString:artwork] : nil;
            if (!url) return;
            [[NSURLSession.sharedSession dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                (void)response;
                if (error || !data || data.length > 10 * 1024 * 1024) return;
                UIImage *image = [UIImage imageWithData:data];
                if (!image) return;
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (generation != artworkGeneration || !nowPlaying) return;
                    nowPlaying[MPMediaItemPropertyArtwork] = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size requestHandler:^UIImage *(CGSize size) { (void)size; return image; }];
                    MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nowPlaying;
                });
            }] resume];
        });
    }
}

void lomify_media_playback(int playing, double position, double rate) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!nowPlaying) return;
        nowPlaying[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
        nowPlaying[MPNowPlayingInfoPropertyDefaultPlaybackRate] = @(rate);
        nowPlaying[MPNowPlayingInfoPropertyPlaybackRate] = @(playing ? rate : 0);
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nowPlaying;
    });
}
