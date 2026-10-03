package com.lomify.next

import org.junit.Assert.*
import org.junit.Test

class AudioFocusLeaseTest {
  @Test fun callKeepsRequestWhilePausedAndDoesNotRequestAgain() {
    val lease = AudioFocusLease()
    lease.granted()
    lease.transientLoss()
    assertFalse(lease.shouldRelease(false))
    assertFalse(lease.shouldAcquire(true))
    assertTrue(lease.registered)
    lease.granted()
    assertTrue(lease.held)
    assertFalse(lease.interrupted)
  }
  @Test fun delayedRequestWaitsForGainInsteadOfLooping() {
    val lease = AudioFocusLease()
    lease.delayed()
    assertFalse(lease.shouldRelease(false))
    assertFalse(lease.shouldAcquire(true))
    lease.granted()
    assertFalse(lease.shouldAcquire(true))
  }
  @Test fun manualPauseAndPermanentLossAllowRelease() {
    for (manual in listOf(true, false)) {
      val lease = AudioFocusLease()
      lease.granted()
      lease.transientLoss()
      if (manual) lease.cancelInterruption() else lease.permanentLoss()
      assertTrue(lease.shouldRelease(false))
      lease.released()
      assertFalse(lease.registered)
      assertTrue(lease.shouldAcquire(true))
    }
  }
}
