// Runs the finder's model on one window: features in (1 × channels × 400), one cosine per tune out.
// The shipped model takes 12 channels (pitch classes); the height model takes 24. Read from the
// model itself, so the app works with whichever the server has.
package com.tunecompanion.app.listen

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import java.io.File
import java.nio.FloatBuffer

class ModelRunner(modelFile: File) : AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(
        modelFile.path,
        OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(2)
        },
    )
    private val frames = ListenEngine.windowShape[1].toLong()

    /** The model's input channels: 12 or 24. */
    val channels: Int = ((session.inputInfo.getValue("windows").info as TensorInfo).shape[1]).toInt()

    /** One window at a time; the listener never overlaps calls. */
    fun cosines(features: List<Float>): List<Float> {
        OnnxTensor.createTensor(env, FloatBuffer.wrap(features.toFloatArray()), longArrayOf(1, channels.toLong(), frames)).use { input ->
            session.run(mapOf("windows" to input)).use { result ->
                val output = result.get("cosines").get() as OnnxTensor
                val buffer = output.floatBuffer
                return FloatArray(buffer.remaining()).also { buffer.get(it) }.asList()
            }
        }
    }

    override fun close() = session.close()
}
