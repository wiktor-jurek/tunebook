// Hand-written companions to the generated Tokens.kt: the Material theme in the web's colours (following the system's
// dark mode unless the person picked light or dark in settings) and the serif the web uses for tune titles.
package com.tunecompanion.app.designsystem

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

private fun scheme(dark: Boolean) = with(Palette) {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    base.copy(
        primary = brandInk.pick(dark),
        onPrimary = onBrandInk.pick(dark),
        secondary = brandDot.pick(dark),
        onSecondary = onBrandDot.pick(dark),
        background = background.pick(dark),
        onBackground = foreground.pick(dark),
        surface = background.pick(dark),
        onSurface = foreground.pick(dark),
        surfaceContainer = card.pick(dark),
        surfaceContainerLow = card.pick(dark),
        surfaceContainerHigh = muted.pick(dark),
        surfaceVariant = muted.pick(dark),
        onSurfaceVariant = mutedForeground.pick(dark),
        secondaryContainer = brandInkSoft.pick(dark),
        outline = border.pick(dark),
        outlineVariant = border.pick(dark),
        error = danger.pick(dark),
    )
}

/** Light, dark, or whatever the phone is set to: the choice in Me's settings, kept on this phone. */
enum class Appearance(val label: String) {
    System("System"), Light("Light"), Dark("Dark");

    companion object {
        private const val KEY = "appearance"
        private var prefs: android.content.SharedPreferences? = null

        /** The current choice. Compose reads it as state, so changing it repaints the app at once. */
        var chosen by mutableStateOf(System)
            private set

        fun load(context: Context) {
            prefs = context.getSharedPreferences("ui", Context.MODE_PRIVATE)
            chosen = prefs?.getString(KEY, null)?.let { saved -> entries.firstOrNull { it.name == saved } } ?: System
        }

        fun choose(appearance: Appearance) {
            chosen = appearance
            prefs?.edit()?.putString(KEY, appearance.name)?.apply()
        }
    }
}

/** Whether the app is dark right now: the setting, or the system's when the setting is System. */
@Composable
@ReadOnlyComposable
fun isAppInDarkTheme(): Boolean = when (Appearance.chosen) {
    Appearance.System -> isSystemInDarkTheme()
    Appearance.Light -> false
    Appearance.Dark -> true
}

private val LocalDark = staticCompositionLocalOf { false }

@Composable
fun TuneCompanionTheme(dark: Boolean = isAppInDarkTheme(), content: @Composable () -> Unit) {
    val colors = scheme(dark)
    MaterialTheme(colorScheme = colors) {
        // Text outside a Surface takes LocalContentColor, which is black unless set: unreadable in dark mode.
        CompositionLocalProvider(LocalDark provides dark, LocalContentColor provides colors.onBackground, content = content)
    }
}

/** A token in the current appearance. */
@Composable
@ReadOnlyComposable
fun ColorPair.current(): Color = pick(LocalDark.current)

/** Tune titles, as the web's --font-music. */
object TuneType {
    val title = TextStyle(fontFamily = FontFamily.Serif, fontSize = 22.sp, lineHeight = 27.sp, letterSpacing = (-0.3).sp)
    val trayTitle = TextStyle(fontFamily = FontFamily.Serif, fontSize = 18.sp, lineHeight = 22.sp)
}
