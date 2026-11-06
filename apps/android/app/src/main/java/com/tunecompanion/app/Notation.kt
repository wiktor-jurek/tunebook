// Music notation, engraved by the Rust notation engine (crates/notation-core, through the listen
// library's bindings, as on the iPhone) and drawn natively: Bravura's glyphs, staff lines, stems, beams
// and ties on a Compose Canvas. No web view: a score is laid out in well under a millisecond and draws
// in the first frame, at its final height.
package com.tunecompanion.app

import android.content.Context
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current
import uniffi.listen_ffi.ScoreEngraving
import uniffi.listen_ffi.ScoreTextKind
import uniffi.listen_ffi.engraveScore

enum class AbcStyle { Phrase, Score }

/** Points (dp) per staff space for opening bars: as abcjs drew them at its 360 staff width. */
private const val PHRASE_SCALE = 5.8f

@Composable
fun AbcView(abc: String, style: AbcStyle, modifier: Modifier = Modifier, playback: ScorePlayback? = null) {
    when (style) {
        AbcStyle.Phrase -> {
            // Opening bars at reading size, as wide as they are.
            val engraving = remember(abc) { Engravings.phrase(abc) }
            ScoreCanvas(engraving, emptySet(), modifier.widthIn(max = 420.dp)
                .size((engraving.width * PHRASE_SCALE).dp, (engraving.height * PHRASE_SCALE).dp)
                .semantics { contentDescription = "Opening bars" })
        }
        AbcStyle.Score -> BoxWithConstraints(modifier.fillMaxWidth()) {
            // Laid out as abcjs did, 400 wide on a phone and 760 given room (a phone on its side, a tablet), scaled to fit.
            val width = if (maxWidth > 600.dp) 760 else 400
            val engraving = remember(abc, width) { Engravings.score(abc, width) }
            LaunchedEffect(abc, playback) { playback?.load(abc) }
            ScoreCanvas(engraving, playback?.playingNotes ?: emptySet(), Modifier.fillMaxWidth()
                .aspectRatio(engraving.width / maxOf(engraving.height, 1f))
                .semantics { contentDescription = "Score" })
        }
    }
}

/** Engravings by tune and width: the engine is fast, but a score redrawn as it plays need not be laid out again. */
private object Engravings {
    private val cache = HashMap<String, ScoreEngraving>()
    /** abcjs's staff width is in its pixels, about eight to a staff space. */
    private const val PIXELS_PER_SPACE = 8f

    fun score(abc: String, width: Int) =
        engraving(abc, "s$width", width / PIXELS_PER_SPACE, if (width in 481..699) 3u else 4u, 0u)

    fun phrase(abc: String) = engraving(abc, "p", 45f, 99u, 2u)

    private fun engraving(abc: String, key: String, width: Float, barsPerLine: UInt, phrase: UInt): ScoreEngraving {
        val id = "$key-$abc"
        cache[id]?.let { return it }
        if (cache.size > 400) cache.clear()
        return engraveScore(abc, width, barsPerLine, phrase).also { cache[id] = it }
    }
}

/** Draws an engraving to fill its frame (which keeps its aspect), notes playing in the brand's orange. */
@Composable
private fun ScoreCanvas(engraving: ScoreEngraving, playing: Set<UInt>, modifier: Modifier) {
    val context = LocalContext.current
    val ink = Palette.foreground.current()
    val lit = Palette.brandDot.current()
    val paints = remember(context) { Paints(context) }
    Canvas(modifier) {
        val s = size.width / maxOf(engraving.width, 1f)
        fun shade(note: Long) = if (note >= 0 && note.toUInt() in playing) lit else ink

        for (line in engraving.lines) {
            drawLine(shade(line.note), Offset(line.x1 * s, line.y1 * s), Offset(line.x2 * s, line.y2 * s), strokeWidth = line.thickness * s)
        }
        for (beam in engraving.beams) {
            val t = beam.thickness * s
            drawPath(Path().apply {
                moveTo(beam.x1 * s, beam.y1 * s)
                lineTo(beam.x2 * s, beam.y2 * s)
                lineTo(beam.x2 * s, beam.y2 * s + t)
                lineTo(beam.x1 * s, beam.y1 * s + t)
                close()
            }, ink)
        }
        for (arc in engraving.arcs) {
            // A crescent: thick in the middle, fine at the ends, as engraved ties are.
            val x1 = arc.x1 * s; val y1 = arc.y1 * s; val x2 = arc.x2 * s; val y2 = arc.y2 * s
            val mx = (x1 + x2) / 2; val my = (y1 + y2) / 2
            val bulge = arc.bulge * s * 2
            val thick = arc.thickness * s * 2 * (if (arc.bulge < 0) 1 else -1)
            drawPath(Path().apply {
                moveTo(x1, y1)
                quadraticTo(mx, my + bulge, x2, y2)
                quadraticTo(mx, my + bulge + thick, x1, y1)
                close()
            }, ink)
        }
        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            val glyph = paints.glyph
            for (g in engraving.glyphs) {
                // Bravura is 4 staff spaces to the em, its glyphs' origin on the baseline.
                glyph.textSize = 4 * g.scale * s
                glyph.color = shade(g.note).toArgb()
                native.drawText(String(Character.toChars(g.code.toInt())), g.x * s, g.y * s, glyph)
            }
            for (text in engraving.texts) {
                val paint = when (text.kind) {
                    ScoreTextKind.CHORD -> paints.chord
                    ScoreTextKind.TUPLET -> paints.tuplet
                    ScoreTextKind.ENDING -> paints.ending
                }
                paint.textSize = text.size * s
                paint.color = ink.toArgb()
                // The engine places text by its bottom left.
                native.drawText(text.text, text.x * s, text.y * s - paint.descent(), paint)
            }
        }
    }
}

private class Paints(context: Context) {
    val glyph = paint(Bravura.typeface(context))
    val chord = paint(Typeface.create(Typeface.SANS_SERIF, 500, false))
    val tuplet = paint(Typeface.create(Typeface.SERIF, Typeface.ITALIC))
    val ending = paint(Typeface.SANS_SERIF)

    private fun paint(face: Typeface) = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = face }
}

/** The music font (SMuFL's Bravura, SIL Open Font Licence), one copy shared with the iPhone's package. */
private object Bravura {
    private var loaded: Typeface? = null
    fun typeface(context: Context): Typeface = loaded ?: Typeface.createFromAsset(context.assets, "Bravura.otf").also { loaded = it }
}

/** ABC helpers, ported from apps/web/src/lib/notation.ts (as the iPhone's Abc.swift). */
object Abc {
    fun forTune(title: String?, kind: String?, meter: String?, mode: String?, abc: String): String {
        if (Regex("^X\\s*:", RegexOption.MULTILINE).containsMatchIn(abc)) return abc
        fun line(value: String?, fallback: String) = (value?.takeIf { it.isNotEmpty() } ?: fallback).replace("\r", " ").replace("\n", " ")
        return "X:1\nT:${line(title, "Untitled")}\nR:${line(kind, "tune")}\nM:${line(meter, "4/4")}\nL:1/8\nQ:1/4=100\nK:${line(mode, "D")}\n$abc"
    }

    /** The score leaves out the title and the rhythm: the screen already says both. */
    fun forScore(title: String?, kind: String?, meter: String?, mode: String?, abc: String) =
        forTune(title, kind, meter, mode, abc).replace(Regex("^[TR]\\s*:[^\\r\\n]*(?:\\r?\\n|$)", RegexOption.MULTILINE), "")

    /** How a tune starts: any pickup and then `bars` full bars of the first part, as full ABC. */
    fun openingPhrase(title: String?, kind: String?, meter: String?, mode: String?, abc: String, bars: Int = 2): String {
        val lines = forScore(title, kind, meter, mode, abc).replace(Regex("^[RQ]\\s*:[^\\r\\n]*(?:\\r?\\n|$)", RegexOption.MULTILINE), "")
            .split("\n").map { it.removeSuffix("\r") }
        val headers = mutableListOf<String>(); val body = mutableListOf<String>()
        for (line in lines) if (body.isEmpty() && Regex("^[A-Za-z]\\s*:").containsMatchIn(line)) headers += line else body += line
        val text = body.joinToString(" ").replace(Regex("%[^\\n]*"), "")
        val measures = mutableListOf<String>()
        var cursor = 0
        for (match in Regex("\\|\\]|\\|\\||\\|:|:\\||::|\\|\\d?|\\[\\d").findAll(text)) {
            text.substring(cursor, match.range.first).trim().takeIf { it.isNotEmpty() }?.let { measures += it }
            cursor = match.range.last + 1
        }
        text.substring(cursor).trim().takeIf { it.isNotEmpty() }?.let { measures += it }
        if (measures.isEmpty()) return (headers + body.joinToString(" ")).joinToString("\n")
        // A first bar much shorter than the second is a pickup: keep it and count full bars after it.
        fun notes(measure: String) = measure.count { it in "ABCDEFGabcdefgz" }
        val pickup = if (measures.size > 1 && notes(measures[0]) * 2 <= notes(measures[1])) 1 else 0
        return (headers + (measures.take(pickup + bars).joinToString(" | ") + " |]")).joinToString("\n")
    }
}
