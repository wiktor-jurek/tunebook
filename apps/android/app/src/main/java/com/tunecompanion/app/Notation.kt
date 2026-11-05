// Music notation drawn by abcjs, the same engine, options and files as the website and the iPhone
// app (the iOS package's Resources are this app's assets), in a transparent WebView that sizes
// itself to the music and stays hidden until it is drawn, so it never flashes blank or jumps.
package com.tunecompanion.app

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray

enum class AbcStyle { Phrase, Score }

/** Heights of scores already drawn, so a score seen again lays out at once. */
private val heights = mutableMapOf<String, Float>()

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AbcView(abc: String, style: AbcStyle, modifier: Modifier = Modifier, playback: ScorePlayback? = null) {
    val key = "$style-${abc.hashCode()}"
    var height by remember(key) { mutableStateOf(heights[key] ?: if (style == AbcStyle.Phrase) 64f else 110f) }
    var drawn by remember(key) { mutableStateOf(false) }
    val shown by animateFloatAsState(if (drawn) 1f else 0f, tween(180), label = "drawn")
    val colour = if (isSystemInDarkTheme()) "#ecece8" else "#171717"
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // Given room (a phone on its side, a tablet), a score lays out wider, as the web's does.
        val wide = style == AbcStyle.Score && maxWidth > 600.dp
        val options = if (style == AbcStyle.Phrase) """{"staffwidth":360,"paddingtop":0,"paddingbottom":0,"paddingleft":0,"paddingright":0}"""
        else """{"staffwidth":${if (wide) 760 else 400},"paddingtop":0,"paddingbottom":0,"wrap":{"minSpacing":1.6,"maxSpacing":2.6,"preferredMeasuresPerLine":4}}"""
        AndroidView(
            modifier = Modifier.then(if (style == AbcStyle.Phrase) Modifier.widthIn(max = 420.dp) else Modifier.fillMaxWidth())
                .height(height.dp).alpha(shown),
            factory = { context ->
                WebView(context).apply {
                    setBackgroundColor(0)
                    isVerticalScrollBarEnabled = false
                    isHorizontalScrollBarEnabled = false
                    settings.javaScriptEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    addJavascriptInterface(object {
                        @JavascriptInterface fun size(value: Float) {
                            post {
                                // -1: a score was just drawn (its height already reported); show it, and its player starts afresh on it.
                                if (value < 0) { drawn = true; playback?.configure(); return@post }
                                heights[key] = value
                                height = value
                            }
                        }
                        @JavascriptInterface fun player(state: String) { post { playback?.receive(state) } }
                    }, "native")
                    playback?.webView = this
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, url: String?) { tag = true; (getTag(R.id.pending) as? String)?.let { view.evaluateJavascript(it, null) } }
                    }
                    loadDataWithBaseURL("file:///android_asset/", if (playback != null) PLAYER_PAGE else PAGE, "text/html", "utf-8", null)
                }
            },
            update = { view ->
                val script = "window.draw(${JSONArray(listOf(abc, colour)).toString().removeSurrounding("[", "]")}, $options)"
                if (view.getTag(R.id.drawn) == script) return@AndroidView
                view.setTag(R.id.drawn, script)
                if (view.tag == true) view.evaluateJavascript(script, null) else view.setTag(R.id.pending, script)
            },
            onRelease = { view -> playback?.let { it.pause(); if (it.webView === view) it.webView = null } },
        )
    }
}

// The same page as the iPhone's AbcView: abcjs draws into #paper; its drawn extent (a clef's tail or a high note can
// pass the SVG's box) is measured and reported, then -1 says it is ready to show.
private const val PAGE = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}#paper svg{display:block;overflow:visible}
.playing-note path,.playing-note ellipse{fill:#C8642A!important;stroke:#C8642A!important}.abcjs-tempo{display:none}</style>
<script src="abcjs-basic-min.js"></script>
<script>
window.draw = function (abc, colour, options) {
  document.body.style.color = colour;
  window.currentVisual = ABCJS.renderAbc("paper", abc, Object.assign({ responsive: "resize", add_classes: true }, options))[0] || null;
  report();
  native.size(-1);
};
function report() {
  var paper = document.getElementById("paper"), svg = paper.querySelector("svg");
  paper.style.paddingTop = "0px";
  var height = paper.getBoundingClientRect().height;
  if (svg) {
    var rect = svg.getBoundingClientRect(), view = svg.viewBox && svg.viewBox.baseVal;
    var scale = view && view.width ? rect.width / view.width : 1, drawn = svg.getBBox();
    var above = Math.max(0, -(drawn.y * scale)), below = Math.max(0, (drawn.y + drawn.height) * scale - rect.height);
    paper.style.paddingTop = Math.ceil(above) + "px";
    height = rect.height + Math.ceil(above) + Math.ceil(below) + 2;
  }
  native.size(height);
}
window.addEventListener("resize", function () { setTimeout(report, 0); });
</script></head><body><div id="paper"></div></body></html>"""

// The page with the website's player beside abcjs. The player reports to the iPhone's message handler; here that is
// bridged to the same native object the size goes to.
private val PLAYER_PAGE = PAGE.replace("</head>", """<script>window.webkit={messageHandlers:{player:{postMessage:function(s){native.player(JSON.stringify(s))}}}};</script>
<script src="score-player.js"></script></head>""")

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
