import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseStoreFile = providers.environmentVariable("QWIKTAPE_RELEASE_KEYSTORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("QWIKTAPE_RELEASE_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("QWIKTAPE_RELEASE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("QWIKTAPE_RELEASE_KEY_PASSWORD").orNull
val releaseCertificate = providers.environmentVariable("QWIKTAPE_RELEASE_CERT_SHA256").orNull
val releaseSigningReady = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
    releaseCertificate,
).all { !it.isNullOrBlank() }

android {
    namespace = "construction.ridgeline.qwiktape"
    compileSdk = 36

    defaultConfig {
        applicationId = "construction.ridgeline.qwiktape"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    lint {
        abortOnError = true
        warningsAsErrors = true
        // Hosted runners may carry the Android 17 preview SDK. Keep the app on
        // current stable API 36 until adopting preview runtime behavior is deliberate.
        disable += "OldTargetApi"
    }
}

tasks.configureEach {
    if (name in setOf("preReleaseBuild", "packageRelease", "bundleRelease")) {
        doFirst {
            if (!releaseSigningReady || !file(releaseStoreFile!!).isFile) {
                throw GradleException(
                    "Release signing is unavailable. Configure the dedicated QwikTape " +
                        "PKCS12 identity; no debug or unsigned fallback is permitted.",
                )
            }
        }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    testImplementation("junit:junit:4.13.2")
}
