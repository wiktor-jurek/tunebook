# UniFFI's bindings reach the Rust library through JNA, which reflects over these.
-keep class com.sun.jna.** { *; }
-keep class uniffi.** { *; }
-dontwarn java.awt.**
# ONNX Runtime's native library builds its result and metadata objects (NodeInfo, TensorInfo, OnnxTensor, ...) through
# JNI by constructor signature; R8 strips those constructors and the app aborts the first time the model loads.
-keep class ai.onnxruntime.** { *; }
