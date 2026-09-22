package com.spartan.attendance.util;

/** Geodesy helpers. The backend is the only place that decides whether a GPS fix is inside a geofence. */
public final class GeoUtil {

    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    private GeoUtil() {
    }

    /** Great-circle distance between two WGS84 points using the Haversine formula, in meters. */
    public static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double dPhi = Math.toRadians(lat2 - lat1);
        double dLambda = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2)
                + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS_METERS * c;
    }

    /** True for finite, in-range coordinates that are not the (0,0) "null island" a broken GPS chip reports. */
    public static boolean isPlausibleFix(double lat, double lon) {
        if (Double.isNaN(lat) || Double.isNaN(lon) || Double.isInfinite(lat) || Double.isInfinite(lon)) {
            return false;
        }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            return false;
        }
        return !(lat == 0.0 && lon == 0.0);
    }
}
