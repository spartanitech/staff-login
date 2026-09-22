package com.spartan.attendance.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GeoUtilTest {

    private static final double SITE_LAT = 9.9252;
    private static final double SITE_LNG = 78.1198;

    @Test
    void sameSpotIsZeroMeters() {
        assertEquals(0.0, GeoUtil.haversineMeters(SITE_LAT, SITE_LNG, SITE_LAT, SITE_LNG), 1e-9);
    }

    @Test
    void oneDegreeOfLatitudeIsAbout111Km() {
        double d = GeoUtil.haversineMeters(10.0, 78.0, 11.0, 78.0);
        assertEquals(111_195.0, d, 50.0);
    }

    @Test
    void cityPairMatchesAnIndependentCalculation() {
        // Madurai -> Chennai. Independent check (equirectangular approximation, fine at this scale):
        //   dLat = 3.1575 deg * 111.19 km = 351.1 km
        //   dLng = 2.1509 deg * 111.19 km * cos(11.5 deg) = 234.5 km
        //   sqrt(351.1^2 + 234.5^2) = 422.2 km
        double d = GeoUtil.haversineMeters(9.9252, 78.1198, 13.0827, 80.2707);
        assertEquals(422_200.0, d, 1_500.0, "distance was " + d);
    }

    @Test
    void isSymmetric() {
        double ab = GeoUtil.haversineMeters(9.9, 78.1, 13.0, 80.2);
        double ba = GeoUtil.haversineMeters(13.0, 80.2, 9.9, 78.1);
        assertEquals(ab, ba, 1e-6);
    }

    @Test
    void pointsAroundTheRadiusFallOnTheRightSideOfA200mGeofence() {
        // 0.0018 degrees of latitude is ~200 m
        double inside = GeoUtil.haversineMeters(SITE_LAT, SITE_LNG, SITE_LAT + 0.0016, SITE_LNG);
        double outside = GeoUtil.haversineMeters(SITE_LAT, SITE_LNG, SITE_LAT + 0.0021, SITE_LNG);
        assertTrue(inside < 200, "inside was " + inside);
        assertTrue(outside > 200, "outside was " + outside);
    }

    @Test
    void handlesTheAntimeridian() {
        double d = GeoUtil.haversineMeters(0.0, 179.9, 0.0, -179.9);
        assertEquals(22_239.0, d, 100.0);
    }

    @Test
    void plausibleFixRejectsBrokenReadings() {
        assertTrue(GeoUtil.isPlausibleFix(SITE_LAT, SITE_LNG));
        assertFalse(GeoUtil.isPlausibleFix(0.0, 0.0), "null island");
        assertFalse(GeoUtil.isPlausibleFix(Double.NaN, 78.0));
        assertFalse(GeoUtil.isPlausibleFix(10.0, Double.POSITIVE_INFINITY));
        assertFalse(GeoUtil.isPlausibleFix(91.0, 78.0));
        assertFalse(GeoUtil.isPlausibleFix(10.0, -181.0));
    }
}
