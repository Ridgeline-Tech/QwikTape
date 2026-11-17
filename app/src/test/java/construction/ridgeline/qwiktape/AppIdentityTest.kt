package construction.ridgeline.qwiktape

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppIdentityTest {
    @Test
    fun packageAndAssetOriginRemainDistinctAndLocal() {
        assertEquals("construction.ridgeline.qwiktape", AppIdentity.PACKAGE_ID)
        assertEquals("https://qwiktape.local", AppIdentity.ASSET_ORIGIN)
        assertTrue(AppIdentity.ASSET_ORIGIN.endsWith(".local"))
    }
}
