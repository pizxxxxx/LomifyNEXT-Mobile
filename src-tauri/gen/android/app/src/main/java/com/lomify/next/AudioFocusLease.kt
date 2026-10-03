package com.lomify.next

/** Keep the focus request registered while a call temporarily suspends playback. */
internal class AudioFocusLease {
  var held = false
    private set
  var interrupted = false
    private set
  var registered = false
    private set

  fun granted() { held = true; interrupted = false; registered = true }
  fun delayed() { held = false; interrupted = true; registered = true }
  fun transientLoss() { held = false; interrupted = true }
  fun permanentLoss() { held = false; interrupted = false }
  fun cancelInterruption() { interrupted = false }
  fun released() { held = false; interrupted = false; registered = false }
  fun shouldAcquire(playing: Boolean) = playing && !held && !interrupted
  fun shouldRelease(playing: Boolean) = registered && !playing && !interrupted
}
