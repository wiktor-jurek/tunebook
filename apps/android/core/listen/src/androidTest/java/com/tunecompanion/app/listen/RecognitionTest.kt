// Names a real recording with the shipped model, the way the phone does: 1 s blocks of 48 kHz
// audio into the Rust session, the model on each window, the decoder's answer. Needs files that
// are not in the repo, pushed to the device and named by instrumentation arguments
// (see `just android-recognise`):
//   finderDir  a folder with model.onnx, tunes.json and popularity.json
//   clip       mono 48 kHz little-endian float32 audio
//   tune       the clip's The Session tune ID
package com.tunecompanion.app.listen

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.listen_ffi.ListenSession
import uniffi.listen_ffi.ListenStatus
import uniffi.listen_ffi.ListenWindow
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(AndroidJUnit4::class)
class RecognitionTest {
    @Test
    fun namesARealRecording() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("no clip given", args.getString("clip") != null)
        val folder = File(args.getString("finderDir")!!)
        val ids = JSONArray(File(folder, "tunes.json").readText()).let { a -> List(a.length()) { a.getLong(it).toUInt() } }
        val books = JSONArray(File(folder, "popularity.json").readText()).let { a -> List(a.length()) { a.getLong(it).toUInt() } }

        val loading = System.nanoTime()
        val runner = ModelRunner(File(folder, "model.onnx"))
        Log.i(TAG, "model loaded in ${(System.nanoTime() - loading) / 1_000_000} ms, ${runner.channels} channels")

        val bytes = ByteBuffer.wrap(File(args.getString("clip")!!).readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val audio = FloatArray(bytes.remaining()).also { bytes.get(it) }
        val session = ListenSession(48_000u, ids, if (books.size == ids.size) books else emptyList(), runner.channels.toUInt())
        var answer: Pair<Int, UInt>? = null
        val millis = mutableListOf<Long>()
        for (second in 0 until audio.size / 48_000) {
            session.pushAudio(audio.copyOfRange(second * 48_000, (second + 1) * 48_000).asList())
            val window = session.nextWindow() as? ListenWindow.Features ?: continue
            val started = System.nanoTime()
            val verdict = session.pushCosines(runner.cosines(window.values))
            millis += (System.nanoTime() - started) / 1_000_000
            Log.i(TAG, "second ${second + 1}: ${verdict.status}, leader ${verdict.candidates.firstOrNull()?.tuneId}, margin ${"%.3f".format(verdict.margin)}")
            if (verdict.status == ListenStatus.MATCH && answer == null) answer = (second + 1) to verdict.candidates[0].tuneId
        }
        Log.i(TAG, "named ${answer?.let { "${it.second} after ${it.first} s" } ?: "nothing"}, median window ${millis.sorted()[millis.size / 2]} ms")
        assertEquals(args.getString("tune")!!.toUInt(), answer?.second)
    }

    private companion object {
        const val TAG = "Recognition"
    }
}
