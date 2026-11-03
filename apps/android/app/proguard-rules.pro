# UniFFI's bindings reach the Rust library through JNA, which reflects over these.
-keep class com.sun.jna.** { *; }
-keep class uniffi.** { *; }
-dontwarn java.awt.**
