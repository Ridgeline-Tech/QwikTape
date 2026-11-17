package construction.ridgeline.qwiktape

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import java.io.ByteArrayInputStream

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled") // Bundled calculator code; remote navigation is blocked below.
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            webViewClient = LocalAssetClient()
            loadUrl("${AppIdentity.ASSET_ORIGIN}/index.html")
        }
        setContentView(webView)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private inner class LocalAssetClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            return request.url.scheme != "https" || request.url.host != "qwiktape.local"
        }

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? {
            val uri = request.url
            if (request.method != "GET" || uri.scheme != "https" || uri.host != "qwiktape.local") {
                return notFound()
            }

            val path = uri.path.orEmpty().removePrefix("/").ifEmpty { "index.html" }
            if (path.split('/').any { it == ".." }) return notFound()

            return runCatching {
                val stream = assets.open(path)
                WebResourceResponse(mimeType(path), "UTF-8", stream)
            }.getOrElse { notFound() }
        }

        private fun mimeType(path: String): String {
            return MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(path.substringAfterLast('.', ""))
                ?: when {
                    path.endsWith(".mjs") -> "text/javascript"
                    path.endsWith(".js") -> "text/javascript"
                    else -> "application/octet-stream"
                }
        }

        private fun notFound(): WebResourceResponse {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                emptyMap(),
                ByteArrayInputStream("Not found".toByteArray()),
            )
        }
    }
}
