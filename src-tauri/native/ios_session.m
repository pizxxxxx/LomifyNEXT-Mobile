#import <AVFoundation/AVFoundation.h>
#include <stdio.h>

int lomify_audio_session_prepare(char *message, size_t capacity) {
    @autoreleasepool {
        NSError *error = nil;
        AVAudioSession *session = [AVAudioSession sharedInstance];
        if (![session setCategory:AVAudioSessionCategoryPlayback error:&error] ||
            ![session setActive:YES error:&error]) {
            snprintf(message, capacity, "%s", error.localizedDescription.UTF8String ?: "Audio session failed");
            return -1;
        }
        return 0;
    }
}
