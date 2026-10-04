package com.lomify.next

import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import androidx.core.content.ContextCompat
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.graphics.Color
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  companion object {
    private var activeActivity = java.lang.ref.WeakReference<MainActivity>(null)
    @JvmStatic fun performHaptic(kind: Int) {
      val activity = activeActivity.get() ?: return
      activity.runOnUiThread {
        if (!activity.isFinishing) activity.window.decorView.performHapticFeedback(
          if (kind == 1) android.view.HapticFeedbackConstants.CONTEXT_CLICK
          else android.view.HapticFeedbackConstants.CLOCK_TICK
        )
      }
    }
  }
  private external fun nativeVisibilityChanged(hidden: Boolean)
  private external fun nativeAudioOutputLost()
  // The playback service may not exist while the first track is downloading.
  private val outputLost = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) nativeAudioOutputLost()
    }
  }
  // The SPA uses state-only navigation; WebView.canGoBack is not reliable for it.
  override val handleBackNavigation: Boolean = false

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.setSupportZoom(false)
    webView.settings.builtInZoomControls = false
    webView.settings.displayZoomControls = false
    webView.settings.mediaPlaybackRequiresUserGesture = false
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('lomify:android-back', {cancelable:true}))"
        ) { unhandled ->
          if (unhandled == "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    activeActivity = java.lang.ref.WeakReference(this)
    ContextCompat.registerReceiver(this, outputLost,
      IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_EXPORTED)
    // Keep the WebView and touch controls outside system bars and display cutouts.
    val content = findViewById<android.view.View>(android.R.id.content)
    content.setBackgroundColor(Color.rgb(16, 16, 20))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.CONSUMED
    }
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onPause() {
    nativeVisibilityChanged(true)
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    nativeVisibilityChanged(false)
  }

  override fun onDestroy() {
    if (activeActivity.get() === this) activeActivity.clear()
    unregisterReceiver(outputLost)
    super.onDestroy()
  }
}
