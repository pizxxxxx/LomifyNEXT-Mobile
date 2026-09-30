package com.lomify.next

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.graphics.Color
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  private external fun nativeVisibilityChanged(hidden: Boolean)
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
}
