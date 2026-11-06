// Names the tunes in a real recording file the way Upload recording does (FileListener), with the shipped model. Needs
// files that are not in the repo, pushed to the device and named by instrumentation arguments
// (see `just android-recognise-file`):
//   finderDir  a folder with model.onnx, tunes.json and popularity.json
//   file       an audio file Android decodes (m4a, mp3, wav, webm, ogg...)
//   fileTune   The Session tune ID the finder should name first
package com.tunecompanion.app.listen

import android.net.Uri
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class FileListenerTest {
    @Test
    fun namesTheTunesInAFile() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("no file given", args.getString("file") != null)
        val folder = File(args.getString("finderDir")!!)
        val ids = JSONArray(File(folder, "tunes.json").readText()).let { a -> List(a.length()) { a.getLong(it).toUInt() } }
        val books = JSONArray(File(folder, "popularity.json").readText()).let { a -> List(a.length()) { a.getLong(it).toUInt() } }
        val model = FinderModel(File(folder, "model.onnx"), ids, if (books.size == ids.size) books else emptyList())
        val runner = ModelRunner(model.modelFile)
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        var rate = 0
        var kept = 0L
        val started = System.nanoTime()
        val result = FileListener.nameTunes(context, Uri.fromFile(File(args.getString("file")!!)), runner, model,
            onRate = { rate = it }, onAudio = { kept += it.size }, progress = {})
        Log.i(TAG, "named ${result.named.joinToString { "${it.tuneId} at ${it.atMs / 1000} s" }} in ${result.durationMs / 1000} s of audio, " +
            "took ${(System.nanoTime() - started) / 1_000_000_000} s")

        assertEquals(args.getString("fileTune")!!.toInt(), result.named.firstOrNull()?.tuneId)
        // Every sample reaches the copy, as the session is kept and uploaded.
        assertTrue(rate > 0)
        assertEquals(result.durationMs, kept * 1000 / rate)
    }

    private companion object { const val TAG = "Recognition" }
}
