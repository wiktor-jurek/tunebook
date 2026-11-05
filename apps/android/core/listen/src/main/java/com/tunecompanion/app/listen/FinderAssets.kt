// The tune finder's model and tune list, the same files the website loads from /finder/. Kept in
// the app's files after the first download (about 36 MB), and refreshed in the background when the
// server's model changes, taking effect at the next launch.
package com.tunecompanion.app.listen

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class FinderModel(
    val modelFile: File,
    /** tunes.json: The Session tune ID for each of the model's outputs. */
    val tuneIds: List<UInt>,
    /** popularity.json in the same order, or empty. */
    val tunebooks: List<UInt>,
)

class FinderAssets(context: Context, private val base: String = "https://tunecompanion.com/finder/") {
    private val folder = File(context.filesDir, "finder")
    private val staging = File(context.cacheDir, "finder-download")
    private val prefs = context.getSharedPreferences("finder", Context.MODE_PRIVATE)

    /** The cached model, or a fresh download reporting progress from 0 to 1. */
    suspend fun load(progress: (Float) -> Unit): FinderModel = withContext(Dispatchers.IO) {
        read() ?: run {
            download(progress)
            read() ?: error("the downloaded finder could not be read")
        }
    }

    /** Downloads a new export if the server's model has changed; it is used from the next launch. */
    suspend fun refreshIfChanged() = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL(base + "model.onnx").openConnection() as HttpURLConnection
            connection.requestMethod = "HEAD"
            val etag = connection.getHeaderField("ETag").also { connection.disconnect() }
            if (etag != null && etag != prefs.getString(VERSION, null)) download {}
        }
    }

    private fun read(): FinderModel? {
        val model = File(folder, "model.onnx")
        val tunes = File(folder, "tunes.json")
        if (!model.exists() || !tunes.exists()) return null
        val ids = uints(tunes.readText())
        val books = File(folder, "popularity.json").takeIf { it.exists() }?.let { uints(it.readText()) }.orEmpty()
        return FinderModel(model, ids, if (books.size == ids.size) books else emptyList())
    }

    private fun download(progress: (Float) -> Unit) {
        staging.deleteRecursively()
        staging.mkdirs()
        for (name in listOf("tunes.json", "popularity.json")) {
            val ok = fetch(name, File(staging, name), progress = {})
            if (!ok && name == "tunes.json") error("could not download tunes.json")
        }
        var etag: String? = null
        if (!fetch("model.onnx", File(staging, "model.onnx"), progress) { etag = it }) error("could not download the model")
        // Swap the whole folder at once, so the model and tune list always come from the same export.
        folder.deleteRecursively()
        if (!staging.renameTo(folder)) error("could not move the finder into place")
        prefs.edit().putString(VERSION, etag).apply()
    }

    private fun fetch(name: String, target: File, progress: (Float) -> Unit, onEtag: (String?) -> Unit = {}): Boolean {
        val connection = URL(base + name).openConnection() as HttpURLConnection
        // A stalled connection fails (and listening says so) rather than sitting at a percentage forever.
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        try {
            if (connection.responseCode != 200) return false
            onEtag(connection.getHeaderField("ETag"))
            val total = connection.contentLengthLong
            var written = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        written += n
                        if (total > 0) progress(written.toFloat() / total)
                    }
                }
            }
            return true
        } finally {
            connection.disconnect()
        }
    }

    private fun uints(json: String) = JSONArray(json).let { a -> List(a.length()) { a.getLong(it).toUInt() } }

    private companion object {
        const val VERSION = "model-etag"
    }
}
