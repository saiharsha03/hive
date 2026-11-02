import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

// google-services.json is a secret of your own Firebase project: kept outside the repo and copied in before a build
// (HIVE_FIREBASE_DIR, default ../../../Hive-mobile/secrets next to the Hive checkout)
val firebaseDir = File(System.getenv("HIVE_FIREBASE_DIR") ?: rootDir.resolve("../../Hive-mobile/secrets").path)
val ownServices = firebaseDir.resolve("google-services.json")
if (ownServices.exists()) ownServices.copyTo(projectDir.resolve("google-services.json"), overwrite = true)

android {
    namespace = "dev.hive.mobile"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.hive.mobile"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    buildFeatures { compose = true }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug") // a personal app, side-loaded: the debug key is enough
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
