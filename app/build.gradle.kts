plugins {
    id("com.android.application")
}

android {
    namespace = "com.cmg.erie"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cmg.erie"
        minSdk = 26
        targetSdk = 34
        versionCode = 40
        versionName = "0.3.19"
    }

    buildTypes {
        debug { isMinifyEnabled = false }
        release {
            isMinifyEnabled = false
            // Intentional: only debug APKs are shipped, via the Build APK
            // Actions artifact (assembleDebug). The release buildType borrows the
            // debug signing config so a release assemble never fails on a
            // missing release keystore. If you ever ship a signed release,
            // replace this with a real release signingConfig (keystore via
            // gradle.properties or CI secrets) and stop relying on debug.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core:1.13.1")
}
