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

// A release build is signed with your own keystore, never the debug key (its password is public, so anyone with that
// file could sign an update that replaces the app). Name it in ~/.gradle/gradle.properties or the environment, never
// in the repo:
//   HIVE_KEYSTORE            path to the keystore (.jks or .keystore)
//   HIVE_KEYSTORE_PASSWORD   its password
//   HIVE_KEY_ALIAS           the key in it
//   HIVE_KEY_PASSWORD        that key's password (default: the keystore's)
// One is made with: keytool -genkeypair -v -keystore hive-release.jks -alias hive -keyalg RSA -keysize 4096 -validity 10000
// A debug build (./gradlew assembleDebug) needs none of this.
fun setting(name: String): String? = ((findProperty(name) as String?) ?: System.getenv(name))?.trim()?.takeIf { it.isNotEmpty() }
val releaseStore = setting("HIVE_KEYSTORE")
val releaseStorePassword = setting("HIVE_KEYSTORE_PASSWORD")
val releaseAlias = setting("HIVE_KEY_ALIAS")
val releaseKeyPassword = setting("HIVE_KEY_PASSWORD") ?: releaseStorePassword
val releaseSigning = releaseStore != null && releaseStorePassword != null && releaseAlias != null

android {
    namespace = "dev.hive.mobile"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.hive.mobile"
        minSdk = 29
        targetSdk = 35
        versionCode = 7
        versionName = "1.0"
    }
    buildFeatures { compose = true }
    // the screenshot tests draw the real screens on the JVM (Robolectric), so they need the app's resources (fonts)
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            // Roborazzi writes the pictures only when told to record
            all { it.systemProperty("roborazzi.test.record", "true") }
        }
    }
    signingConfigs {
        if (releaseSigning) create("release") {
            storeFile = file(releaseStore!!)
            storePassword = releaseStorePassword
            keyAlias = releaseAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") // none without the settings above: the build stops below
        }
    }
}

// no release APK or bundle without a release key: stop with the reason instead of producing an unsigned or debug-signed one
gradle.taskGraph.whenReady {
    val release = allTasks.any { it.project == project && it.name.contains("Release") && Regex("^(assemble|bundle|package|install|sign)").containsMatchIn(it.name) }
    if (release) {
        if (!releaseSigning) throw GradleException(
            "A release build of the Hive app needs your own signing key. Set HIVE_KEYSTORE, HIVE_KEYSTORE_PASSWORD and HIVE_KEY_ALIAS " +
                "(and HIVE_KEY_PASSWORD if it differs) in ~/.gradle/gradle.properties or the environment; see mobile/app/build.gradle.kts. " +
                "The debug key is never used for a release. For a build to try on your own phone: ./gradlew assembleDebug",
        )
        if (!file(releaseStore!!).isFile) throw GradleException("HIVE_KEYSTORE points to ${file(releaseStore)}, which is not a file.")
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
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.mikepenz:multiplatform-markdown-renderer-m3:0.30.0")

    // unit tests of the sealed link (Link.kt) on the JVM; org.json there is the real one, not Android's empty stub
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    // every screen drawn to a PNG without a device (ScreensTest): Robolectric runs Compose, Roborazzi captures it
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.40.1")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.40.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
