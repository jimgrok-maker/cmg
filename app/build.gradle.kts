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
        versionCode = 15
        versionName = "0.2.4"
    }

    buildTypes {
        debug { isMinifyEnabled = false }
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
