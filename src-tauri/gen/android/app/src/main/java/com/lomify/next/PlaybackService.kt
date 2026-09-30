package com.lomify.next

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** A small Android shell for the existing Rust player, not a second decoder. */
class PlaybackService : Service() {
  private external fun nativeMediaAction(action: String, value: Long)

  private lateinit var mediaSession: MediaSession
  private lateinit var notificationManager: NotificationManager
  private lateinit var audioManager: AudioManager
  private lateinit var focusRequest: AudioFocusRequest
  private lateinit var playbackWakeLock: PowerManager.WakeLock
  private val artworkWorker = Executors.newSingleThreadExecutor()
  private var artworkUrl: String? = null
  private var artwork: Bitmap? = null
  private var fallbackArtwork: Bitmap? = null
  private var artworkRequest = 0
  private var focusHeld = false
  private val expirePaused = Runnable { if (!playing) stopSelf() }
  private val becomingNoisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && playing) control("pause")
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    notificationManager = getSystemService(NotificationManager::class.java)
    fallbackArtwork = BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)
    audioManager = getSystemService(AudioManager::class.java)
    playbackWakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "com.lomify.next:playback")
      .apply { setReferenceCounted(false) }
    notificationManager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Воспроизведение", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Музыка и кнопки управления LomifyNEXT"
        setShowBadge(false)
      }
    )
    focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
      )
      .setOnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
          main.post { if (playing) control("pause") }
        }
      }.build()
    mediaSession = MediaSession(this, "LomifyNEXT").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = control("play")
        override fun onPause() = control("pause")
        override fun onSkipToNext() = control("next")
        override fun onSkipToPrevious() = control("previous")
        override fun onSeekTo(pos: Long) = control("seek", pos)
        override fun onStop() = control("stop")
      })
      isActive = true
    }
    registerReceiver(becomingNoisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
    requestArtwork()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PLAY -> { control("play"); return START_NOT_STICKY }
      ACTION_PAUSE -> { control("pause"); return START_NOT_STICKY }
      ACTION_NEXT -> { control("next"); return START_NOT_STICKY }
      ACTION_PREVIOUS -> { control("previous"); return START_NOT_STICKY }
    }
    publish()
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    control("stop")
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    main.removeCallbacks(expirePaused)
    unregisterReceiver(becomingNoisy)
    artworkWorker.shutdownNow()
    if (focusHeld) audioManager.abandonAudioFocusRequest(focusRequest)
    if (playbackWakeLock.isHeld) playbackWakeLock.release()
    mediaSession.isActive = false
    mediaSession.release()
    notificationManager.cancel(NOTIFICATION_ID)
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun control(action: String, value: Long = 0L) {
    when (action) {
      "play" -> playing = true
      "pause", "stop" -> playing = false
      "seek" -> positionMs = value.coerceAtLeast(0L)
    }
    if (action == "stop") {
      stopSelf()
    } else {
      publish()
    }
    nativeMediaAction(action, value)
  }

  private fun publish() {
    main.removeCallbacks(expirePaused)
    if (playing && !playbackWakeLock.isHeld) playbackWakeLock.acquire()
    else if (!playing && playbackWakeLock.isHeld) playbackWakeLock.release()
    if (playing && !focusHeld) {
      focusHeld = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else if (!playing) {
      if (focusHeld) audioManager.abandonAudioFocusRequest(focusRequest)
      focusHeld = false
      main.postDelayed(expirePaused, PAUSED_TIMEOUT_MS)
    }
    val state = if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
    mediaSession.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
            PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or
            PlaybackState.ACTION_STOP
        )
        .setState(state, positionMs, if (playing) 1f else 0f, SystemClock.elapsedRealtime())
        .build()
    )
    mediaSession.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
        .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
        .apply { (artwork ?: fallbackArtwork)?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
        .build()
    )
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(artist)
      .setLargeIcon(artwork ?: fallbackArtwork)
      .setContentIntent(
        PendingIntent.getActivity(
          this, 0, Intent(this, MainActivity::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setOnlyAlertOnce(true)
      .setOngoing(playing)
      .addAction(android.R.drawable.ic_media_previous, "Назад", actionIntent(ACTION_PREVIOUS, 1))
      .addAction(
        if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (playing) "Пауза" else "Продолжить",
        actionIntent(if (playing) ACTION_PAUSE else ACTION_PLAY, 2)
      )
      .addAction(android.R.drawable.ic_media_next, "Дальше", actionIntent(ACTION_NEXT, 3))
      .setStyle(
        Notification.MediaStyle().setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
    if (playing) startForeground(NOTIFICATION_ID, notification)
    else notificationManager.notify(NOTIFICATION_ID, notification)
  }

  private fun actionIntent(action: String, requestCode: Int): PendingIntent =
    PendingIntent.getService(
      this, requestCode, Intent(this, PlaybackService::class.java).setAction(action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun requestArtwork() {
    val url = coverUrl?.takeIf { it.startsWith("https://", ignoreCase = true) } ?: run {
      artworkUrl = null
      artwork = null
      return
    }
    if (url == artworkUrl) return
    artworkUrl = url
    artwork = null
    val request = ++artworkRequest
    artworkWorker.execute {
      val bitmap = try {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
          connectTimeout = 3500
          readTimeout = 3500
          instanceFollowRedirects = true
        }
        try {
          connection.inputStream.use { input ->
            val bytes = ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (bytes.size() <= MAX_ARTWORK_BYTES) {
              val count = input.read(chunk)
              if (count < 0) break
              bytes.write(chunk, 0, count)
            }
            if (bytes.size() > MAX_ARTWORK_BYTES) null else {
              val data = bytes.toByteArray()
              val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
              BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
              var sample = 1
              while (bounds.outWidth / sample > 384 || bounds.outHeight / sample > 384) sample *= 2
              BitmapFactory.decodeByteArray(data, 0, data.size,
                BitmapFactory.Options().apply {
                  inSampleSize = sample
                  inPreferredConfig = Bitmap.Config.RGB_565
                })
            }
          }
        } finally { connection.disconnect() }
      } catch (_: Exception) { null }
      main.post {
        if (instance === this && artworkRequest == request) {
          artwork = bitmap
          publish()
        }
      }
    }
  }

  companion object {
    private const val CHANNEL_ID = "lomify_playback"
    private const val NOTIFICATION_ID = 7001
    private const val PAUSED_TIMEOUT_MS = 10 * 60 * 1000L
    private const val MAX_ARTWORK_BYTES = 1_500_000
    private const val ACTION_PLAY = "com.lomify.next.PLAY"
    private const val ACTION_PAUSE = "com.lomify.next.PAUSE"
    private const val ACTION_NEXT = "com.lomify.next.NEXT"
    private const val ACTION_PREVIOUS = "com.lomify.next.PREVIOUS"
    private val main = Handler(Looper.getMainLooper())
    private var instance: PlaybackService? = null
    private var title = "LomifyNEXT"
    private var artist = "Музыка"
    private var coverUrl: String? = null
    private var durationMs = 0L
    private var positionMs = 0L
    private var playing = false

    @JvmStatic fun updateMetadata(newTitle: String, newArtist: String, newCoverUrl: String?, newDurationMs: Long) {
      main.post {
        title = newTitle.ifBlank { "Неизвестный трек" }
        artist = newArtist.ifBlank { "Неизвестный исполнитель" }
        durationMs = newDurationMs.coerceAtLeast(0L)
        positionMs = 0L
        if (coverUrl != newCoverUrl) {
          coverUrl = newCoverUrl
          instance?.requestArtwork()
        }
        instance?.publish()
      }
    }

    @JvmStatic fun updatePlayback(context: Context, isPlaying: Boolean, newPositionMs: Long) {
      main.post {
        playing = isPlaying
        positionMs = newPositionMs.coerceAtLeast(0L)
        if (isPlaying && instance == null) {
          context.startForegroundService(Intent(context, PlaybackService::class.java))
        } else instance?.publish()
      }
    }

    @JvmStatic fun updatePosition(newPositionMs: Long) {
      main.post {
        positionMs = newPositionMs.coerceAtLeast(0L)
        instance?.publish()
      }
    }
  }
}
