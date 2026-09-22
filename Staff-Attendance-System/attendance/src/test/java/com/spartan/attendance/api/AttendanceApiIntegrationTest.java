package com.spartan.attendance.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

/**
 * End-to-end tests of the real Spring context (Spring Security + JWT + JPA on H2 in MySQL mode).
 * They cover the behaviours that matter most: Admin login, BCrypt, role enforcement,
 * server-side geofencing (work locations for staff, shops + a live photo for Sales Officers), duplicate protection,
 * scoping and audited corrections.
 *
 * Demo staff (owner01, areasales01, sales01 ...) are created by DataInitializer because the
 * "test" profile sets app.seed.demo-users=true.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AttendanceApiIntegrationTest {

    private static final double SITE_LAT = 9.9252;
    private static final double SITE_LNG = 78.1198;

    @Autowired
    MockMvc mvc;
    @Autowired
    UserRepository users;

    // ------------------------------------------------------------------ helpers
    private String login(String username, String password) throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.token");
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON);
    }

    private String adminToken() throws Exception {
        return login("Admin", "Admin@123");
    }

    private String gps(double lat, double lng, double accuracy) {
        return "{\"latitude\":" + lat + ",\"longitude\":" + lng + ",\"accuracy\":" + accuracy + "}";
    }

    /** Makes sure one 200 m geofence exists around the test site. */
    private void ensureWorkLocation() throws Exception {
        String admin = adminToken();
        MvcResult r = mvc.perform(auth(get("/api/work-locations"), admin)).andExpect(status().isOk()).andReturn();
        int existing = JsonPath.read(r.getResponse().getContentAsString(), "$.length()");
        if (existing == 0) {
            mvc.perform(auth(post("/api/work-locations"), admin).content(
                    "{\"name\":\"Test HQ\",\"address\":\"Test\",\"latitude\":" + SITE_LAT + ",\"longitude\":" + SITE_LNG
                            + ",\"allowedRadiusMeters\":200,\"status\":\"ACTIVE\"}")).andExpect(status().isCreated());
        }
    }

    /** Just enough of a JPEG for the server's magic-number check (it never decodes the image). */
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0};

    private record Officer(String token, long userId, long shopId) {
    }

    /**
     * A brand-new Sales Officer with one shop assigned to them at the given point, so every test that checks in gets its own
     * person and is independent of test order.
     */
    private Officer newOfficer(String tag, double shopLat, double shopLng, int radius) throws Exception {
        String admin = adminToken();
        String username = "so." + tag;
        MvcResult u = mvc.perform(auth(post("/api/users"), admin).content(
                        "{\"name\":\"Test " + tag + "\",\"username\":\"" + username + "\",\"password\":\"Sales#12345\",\"role\":\"SO\"}"))
                .andExpect(status().is2xxSuccessful()).andReturn();
        long userId = ((Number) JsonPath.read(u.getResponse().getContentAsString(), "$.id")).longValue();
        long shopId = createShop(admin, "T-" + tag, "Shop " + tag, shopLat, shopLng, radius, userId);
        return new Officer(login(username, "Sales#12345"), userId, shopId);
    }

    private long createShop(String admin, String code, String name, double lat, double lng, int radius, Long officerId) throws Exception {
        MvcResult s = mvc.perform(auth(post("/api/admin/shops"), admin).content(
                        "{\"code\":\"" + code + "\",\"name\":\"" + name + "\",\"latitude\":" + lat + ",\"longitude\":" + lng
                                + ",\"allowedRadiusMeters\":" + radius + (officerId == null ? "" : ",\"assignedOfficerId\":" + officerId) + "}"))
                .andExpect(status().isCreated()).andReturn();
        return ((Number) JsonPath.read(s.getResponse().getContentAsString(), "$.id")).longValue();
    }

    /** The seeded demo shop with this code (SHP001 = Ravi's, SHP004 = Murugan's, SHP006 = Kumar's). */
    private long demoShopId(String code) throws Exception {
        String body = mvc.perform(auth(get("/api/admin/shops"), adminToken())).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.<java.util.List<Object>>read(body, "$[?(@.code=='" + code + "')].id").get(0)).longValue();
    }

    /** POST /api/attendance/shop-check-in as multipart form data. A null photo sends the form without the file part. */
    private RequestBuilder shopCheckIn(String token, long shopId, double lat, double lng, double accuracy, byte[] photo) {
        MockMultipartHttpServletRequestBuilder b = multipart("/api/attendance/shop-check-in");
        if (photo != null) {
            b.file(new MockMultipartFile("photo", "shop.jpg", "image/jpeg", photo));
        }
        b.param("shopId", String.valueOf(shopId));
        b.param("latitude", String.valueOf(lat));
        b.param("longitude", String.valueOf(lng));
        b.param("accuracy", String.valueOf(accuracy));
        b.header("Authorization", "Bearer " + token);
        return b;
    }

    // ------------------------------------------------------------------ authentication
    @Test
    void adminCanLogInWithTheRequiredCredentials() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"Admin\",\"password\":\"Admin@123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andExpect(jsonPath("$.user.status").value("ACTIVE"))
                .andExpect(jsonPath("$.user.username").value("Admin"));
    }

    @Test
    void adminIsStoredEnabledAndBcryptHashed() {
        User admin = users.findByUsernameIgnoreCase("Admin").orElseThrow();
        assertEquals(Role.ADMIN, admin.getRole());
        assertEquals(Status.ACTIVE, admin.getStatus());
        assertTrue(admin.getPasswordHash().startsWith("$2"), "password must be a BCrypt hash, was: " + admin.getPasswordHash());
        assertTrue(!admin.getPasswordHash().contains("Admin@123"));
    }

    @Test
    void usernameIsCaseInsensitive() throws Exception {
        login("admin", "Admin@123");
    }

    @Test
    void wrongPasswordIsRejected() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"Admin\",\"password\":\"nope\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void oldWrongAdminPairStaysRejected() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin01\",\"password\":\"001\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointsNeedAToken() throws Exception {
        mvc.perform(get("/api/attendance/today")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void roleComesFromTheDatabaseNotFromTheClient() throws Exception {
        // The login body has no role field at all; a Sales Officer always comes back as SO.
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"sales01\",\"password\":\"Sales@123\",\"role\":\"ADMIN\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("SO"));
    }

    // ------------------------------------------------------------------ authorisation
    @Test
    void salesOfficerCannotUseAdminOrManagerEndpoints() throws Exception {
        String so = login("sales01", "Sales@123");
        mvc.perform(auth(get("/api/admin/attendance"), so)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/admin/audit-logs"), so)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/admin/shops"), so)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/attendance/team"), so)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/users"), so).content(
                "{\"name\":\"X\",\"username\":\"hacker1\",\"password\":\"Password#1\",\"role\":\"ADMIN\"}")).andExpect(status().isForbidden());
    }

    @Test
    void deactivatedUserCannotLogInAndTheirTokenStopsWorking() throws Exception {
        String victimToken = login("sales02", "Sales@123");
        Long victimId = users.findByUsernameIgnoreCase("sales02").orElseThrow().getId();
        try {
            mvc.perform(auth(patch("/api/users/" + victimId + "/status"), adminToken()).content("{\"status\":\"INACTIVE\"}"))
                    .andExpect(status().isOk());
            mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"username\":\"sales02\",\"password\":\"Sales@123\"}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("ACCOUNT_INACTIVE"));
            mvc.perform(auth(get("/api/attendance/today"), victimToken)).andExpect(status().isUnauthorized());
        } finally {
            mvc.perform(auth(patch("/api/users/" + victimId + "/status"), adminToken()).content("{\"status\":\"ACTIVE\"}"));
        }
    }

    @Test
    void anAdminCannotDeactivateTheirOwnAccount() throws Exception {
        Long adminId = users.findByUsernameIgnoreCase("Admin").orElseThrow().getId();
        mvc.perform(auth(patch("/api/users/" + adminId + "/status"), adminToken()).content("{\"status\":\"INACTIVE\"}"))
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ GPS attendance (staff: work locations)
    @Test
    void staffCheckInOutsideTheGeofenceIsRefusedByTheServer() throws Exception {
        ensureWorkLocation();
        String asm = login("areasales01", "Asm@123");
        mvc.perform(auth(post("/api/attendance/check-in"), asm).content(gps(SITE_LAT + 0.02, SITE_LNG, 10)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("OUTSIDE_GEOFENCE"))
                .andExpect(jsonPath("$.details.allowedRadiusMeters").value(200));
    }

    @Test
    void staffPoorGpsAccuracyIsRefused() throws Exception {
        ensureWorkLocation();
        String asm = login("areasales01", "Asm@123");
        mvc.perform(auth(post("/api/attendance/check-in"), asm).content(gps(SITE_LAT, SITE_LNG, 900)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("POOR_GPS_ACCURACY"));
    }

    @Test
    void checkOutBeforeCheckInIsRefused() throws Exception {
        ensureWorkLocation();
        String asm = login("areasales02", "Asm@123");
        mvc.perform(auth(post("/api/attendance/check-out"), asm).content(gps(SITE_LAT, SITE_LNG, 5)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("NOT_CHECKED_IN"));
    }

    @Test
    void salesOfficerCannotUseThePlainWorkLocationCheckIn() throws Exception {
        ensureWorkLocation();
        String so = login("sales02", "Sales@123");
        mvc.perform(auth(post("/api/attendance/check-in"), so).content(gps(SITE_LAT, SITE_LNG, 5)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SHOP_CHECKIN_REQUIRED"));
    }

    // ------------------------------------------------------------------ shop attendance (Sales Officers)
    @Test
    void shopCheckInOutsideTheShopRadiusIsRefused() throws Exception {
        Officer o = newOfficer("far", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT + 0.02, SITE_LNG, 10, JPEG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("OUTSIDE_GEOFENCE"))
                .andExpect(jsonPath("$.details.allowedRadiusMeters").value(50))
                .andExpect(jsonPath("$.details.shopName").value("Shop far"));
    }

    @Test
    void shopCheckInWithPoorAccuracyOrBadCoordinatesIsRefused() throws Exception {
        Officer o = newOfficer("gps", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 900, JPEG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("POOR_GPS_ACCURACY"));
        mvc.perform(shopCheckIn(o.token(), o.shopId(), 0.0, 0.0, 5, JPEG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_GPS"));
        mvc.perform(shopCheckIn(o.token(), o.shopId(), 123.0, 5.0, 5, JPEG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_GPS"));
    }

    @Test
    void shopCheckInNeedsARealImage() throws Exception {
        Officer o = newOfficer("photo", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 5, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PHOTO_REQUIRED"));
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 5, "<html>not an image at all</html>".getBytes()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PHOTO"));
        // nothing was recorded by the two refused attempts
        mvc.perform(auth(get("/api/attendance/today"), o.token())).andExpect(jsonPath("$.state").value("NOT_CHECKED_IN"));
    }

    @Test
    void aShopThatIsNotYoursCannotBeUsed() throws Exception {
        Officer mine = newOfficer("mine", SITE_LAT, SITE_LNG, 50);
        Officer theirs = newOfficer("theirs", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(mine.token(), theirs.shopId(), SITE_LAT, SITE_LNG, 5, JPEG))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SHOP_NOT_ASSIGNED"));
        // a manager cannot use the officer check-in at all
        mvc.perform(shopCheckIn(login("areasales01", "Asm@123"), mine.shopId(), SITE_LAT, SITE_LNG, 5, JPEG))
                .andExpect(status().isForbidden());
    }

    @Test
    void fullDayFlow_shopCheckIn_duplicate_checkOut_duplicate_photo() throws Exception {
        Officer o = newOfficer("flow", SITE_LAT, SITE_LNG, 50);

        mvc.perform(auth(get("/api/attendance/today"), o.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("NOT_CHECKED_IN"));

        // about 11 m from the shop, inside its 50 m radius
        MvcResult in = mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT + 0.0001, SITE_LNG, 12, JPEG))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.shopName").value("Shop flow"))
                .andExpect(jsonPath("$.shopCode").value("T-flow"))
                .andExpect(jsonPath("$.hasPhoto").value(true))
                .andExpect(jsonPath("$.workLocationName").doesNotExist())
                .andExpect(jsonPath("$.checkInDistanceMeters").isNumber())
                .andReturn();
        int attendanceId = JsonPath.read(in.getResponse().getContentAsString(), "$.id");

        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 12, JPEG))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_CHECKED_IN"));

        mvc.perform(auth(get("/api/attendance/today"), o.token()))
                .andExpect(jsonPath("$.state").value("CHECKED_IN"));

        // the live photo can be read by the officer and the Admin, but not by another officer
        MvcResult photo = mvc.perform(auth(get("/api/attendance/" + attendanceId + "/photo"), o.token()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/jpeg"))
                .andReturn();
        assertEquals(JPEG.length, photo.getResponse().getContentAsByteArray().length);
        mvc.perform(auth(get("/api/attendance/" + attendanceId + "/photo"), adminToken())).andExpect(status().isOk());
        mvc.perform(auth(get("/api/attendance/" + attendanceId + "/photo"), login("sales01", "Sales@123")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("OUT_OF_SCOPE"));

        // a Sales Officer works in the field: check-out needs a good GPS fix but not a geofence
        mvc.perform(auth(post("/api/attendance/check-out"), o.token()).content(gps(SITE_LAT + 0.5, SITE_LNG, 8)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkOutTime").isNotEmpty())
                .andExpect(jsonPath("$.workingHours").isNotEmpty());
        mvc.perform(auth(post("/api/attendance/check-out"), o.token()).content(gps(SITE_LAT, SITE_LNG, 8)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_CHECKED_OUT"));

        mvc.perform(auth(get("/api/attendance/today"), o.token()))
                .andExpect(jsonPath("$.state").value("COMPLETED"));
        mvc.perform(auth(get("/api/attendance/my"), o.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].employeeName").value("Test flow"));
    }

    @Test
    void aCheckOutWithAnUnusableGpsFixIsStillRefusedForSalesOfficers() throws Exception {
        Officer o = newOfficer("out", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 5, JPEG)).andExpect(status().isCreated());
        mvc.perform(auth(post("/api/attendance/check-out"), o.token()).content(gps(SITE_LAT, SITE_LNG, 900)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("POOR_GPS_ACCURACY"));
    }

    // ------------------------------------------------------------------ shops (Admin management + what an officer sees)
    @Test
    void adminManagesShopsAndOfficersOnlySeeTheirOwn() throws Exception {
        String admin = adminToken();
        Long ravi = users.findByUsernameIgnoreCase("sales01").orElseThrow().getId();
        Long asm = users.findByUsernameIgnoreCase("areasales01").orElseThrow().getId();

        // blank code is generated by the server
        MvcResult made = mvc.perform(auth(post("/api/admin/shops"), admin).content(
                        "{\"name\":\"Generated Code Store\",\"latitude\":9.93,\"longitude\":78.09,\"assignedOfficerId\":" + ravi + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code", startsWith("SHP")))
                .andExpect(jsonPath("$.allowedRadiusMeters").value(50))
                .andExpect(jsonPath("$.assignedOfficerName").value("Ravi"))
                .andReturn();
        int shopId = JsonPath.read(made.getResponse().getContentAsString(), "$.id");
        String code = JsonPath.read(made.getResponse().getContentAsString(), "$.code");

        // duplicate code, a non-officer assignee and a silly radius are refused
        mvc.perform(auth(post("/api/admin/shops"), admin).content(
                        "{\"code\":\"" + code + "\",\"name\":\"Dup\",\"latitude\":9.93,\"longitude\":78.09}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SHOP_CODE_TAKEN"));
        mvc.perform(auth(post("/api/admin/shops"), admin).content(
                        "{\"name\":\"Bad Assignee\",\"latitude\":9.93,\"longitude\":78.09,\"assignedOfficerId\":" + asm + "}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_OFFICER"));
        mvc.perform(auth(post("/api/admin/shops"), admin).content(
                        "{\"name\":\"Huge\",\"latitude\":9.93,\"longitude\":78.09,\"allowedRadiusMeters\":9000}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        // Ravi sees it, Murugan does not; deactivating removes it from Ravi's list; the audit log has the changes
        String raviToken = login("sales01", "Sales@123");
        mvc.perform(auth(get("/api/shops/mine"), raviToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code=='" + code + "')]", hasSize(1)));
        String murugan = mvc.perform(auth(get("/api/shops/mine"), login("sales02", "Sales@123"))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(!murugan.contains(code) && !murugan.contains("Sri Ganesh Stores"), "an officer must only see their own shops");

        mvc.perform(auth(patch("/api/admin/shops/" + shopId + "/status"), admin).content("{\"status\":\"INACTIVE\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INACTIVE"));
        mvc.perform(auth(get("/api/shops/mine"), raviToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code=='" + code + "')]", hasSize(0)));
        mvc.perform(shopCheckIn(raviToken, shopId, 9.93, 78.09, 5, JPEG))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SHOP_NOT_ASSIGNED"));

        String audit = mvc.perform(auth(get("/api/admin/audit-logs?size=200"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(audit.contains("\"SHOP_CREATE\"") && audit.contains("\"SHOP_STATUS_CHANGE\""), "shop changes must be audited");

        // /api/shops/mine is for Sales Officers only
        mvc.perform(auth(get("/api/shops/mine"), admin)).andExpect(status().isForbidden());
    }

    @Test
    void adminDeletesAShopAndKeepsPastAttendance() throws Exception {
        Officer o = newOfficer("shopdel", 11.0, 77.0, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), 11.0, 77.0, 10, JPEG)).andExpect(status().isCreated());
        String admin = adminToken();

        mvc.perform(auth(delete("/api/admin/shops/" + o.shopId()), admin))
                .andExpect(status().isNoContent());

        String shops = mvc.perform(auth(get("/api/admin/shops"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(((java.util.List<?>) JsonPath.read(shops, "$[?(@.id==" + o.shopId() + ")]")).isEmpty(), "the shop must be gone");

        String today = mvc.perform(auth(get("/api/attendance/today"), o.token())).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("CHECKED_IN", JsonPath.read(today, "$.state"), "the attendance record itself must survive the shop's deletion");
        Object shopIdAfter = JsonPath.read(today, "$.attendance.shopId");
        assertTrue(shopIdAfter == null, "the deleted shop's id must no longer be linked to the attendance record");

        String audit = mvc.perform(auth(get("/api/admin/audit-logs?size=200"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(audit.contains("\"SHOP_DELETE\""), "shop deletion must be audited");
    }

    @Test
    void adminDeletesAStaffAccount_refusedForSelfOrSubordinates_elseRemovesThemAndUnassignsTheirShops() throws Exception {
        String admin = adminToken();

        // cannot delete your own account
        long adminId = users.findByUsernameIgnoreCase("Admin").orElseThrow().getId();
        mvc.perform(auth(delete("/api/users/" + adminId), admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CANNOT_DELETE_SELF"));

        // cannot delete a manager who still has someone reporting to them
        long asm1 = users.findByUsernameIgnoreCase("areasales01").orElseThrow().getId();
        mvc.perform(auth(delete("/api/users/" + asm1), admin))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("HAS_SUBORDINATES"))
                .andExpect(jsonPath("$.message", containsString("Ravi")));

        // a fresh officer with a shop and a check-in: deleting them removes their account and history,
        // and unassigns (rather than deletes) the shop that was theirs
        Officer o = newOfficer("userdel", 12.0, 77.5, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), 12.0, 77.5, 10, JPEG)).andExpect(status().isCreated());

        mvc.perform(auth(delete("/api/users/" + o.userId()), admin))
                .andExpect(status().isNoContent());

        String usersJson = mvc.perform(auth(get("/api/users"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(((java.util.List<?>) JsonPath.read(usersJson, "$[?(@.id==" + o.userId() + ")]")).isEmpty(), "the deleted officer must be gone");

        String shopsJson = mvc.perform(auth(get("/api/admin/shops"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Object officerIdAfter = ((java.util.List<?>) JsonPath.read(shopsJson, "$[?(@.id==" + o.shopId() + ")].assignedOfficerId")).get(0);
        assertTrue(officerIdAfter == null, "the shop must stay but become unassigned, not be deleted with the officer");

        String audit = mvc.perform(auth(get("/api/admin/audit-logs?size=200"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(audit.contains("\"USER_DELETE\""), "user deletion must be audited");
    }

    @Test
    void auditLogRecordsLoginAndAttendanceActions() throws Exception {
        Officer o = newOfficer("audit", SITE_LAT, SITE_LNG, 50);
        mvc.perform(shopCheckIn(o.token(), o.shopId(), SITE_LAT, SITE_LNG, 10, JPEG)).andExpect(status().isCreated());
        String body = mvc.perform(auth(get("/api/admin/audit-logs?size=200"), adminToken()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"LOGIN\""), "LOGIN missing from audit log");
        assertTrue(body.contains("\"CHECK_IN\""), "CHECK_IN missing from audit log");
    }

    @Test
    void aMissingPageIsA404NotA500() throws Exception {
        mvc.perform(get("/favicon.ico")).andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ scoping
    @Test
    void managerSeesOnlyTheirOwnTeam_ownerSeesEveryone() throws Exception {
        // sales03 reports to areasales02; sales01 reports to areasales01. Make sure both have a record today,
        // each at their own demo shop (SHP001 = Anna Nagar, Madurai; SHP006 = T. Nagar, Chennai).
        mvc.perform(shopCheckIn(login("sales01", "Sales@123"), demoShopId("SHP001"), 9.9382, 78.0878, 10, JPEG));   // 201 or 409, both fine
        mvc.perform(shopCheckIn(login("sales03", "Sales@123"), demoShopId("SHP006"), 13.0418, 80.2341, 10, JPEG));
        String asm1 = login("areasales01", "Asm@123");
        String team = mvc.perform(auth(get("/api/attendance/team"), asm1)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(team.contains("Ravi"), "ASM1 should see their own officer");
        assertTrue(!team.contains("Kumar"), "ASM1 must not see ASM2's officer");

        Long kumarId = users.findByUsernameIgnoreCase("sales03").orElseThrow().getId();
        mvc.perform(auth(get("/api/attendance/team?userId=" + kumarId), asm1))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("OUT_OF_SCOPE"));
        mvc.perform(auth(get("/api/attendance/summary?userId=" + kumarId), asm1)).andExpect(status().isForbidden());

        String owner = login("owner01", "password123");
        String all = mvc.perform(auth(get("/api/attendance/team"), owner)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(all.contains("Ravi") && all.contains("Kumar"), "Owner should see everyone");
    }

    // ------------------------------------------------------------------ corrections
    @Test
    void correctionNeedsAReasonAndIsAudited() throws Exception {
        mvc.perform(shopCheckIn(login("sales01", "Sales@123"), demoShopId("SHP001"), 9.9382, 78.0878, 10, JPEG));   // may already exist
        String admin = adminToken();
        String list = mvc.perform(auth(get("/api/admin/attendance"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Integer id = JsonPath.<java.util.List<Integer>>read(list, "$[?(@.employeeName=='Ravi')].id").get(0);

        mvc.perform(auth(put("/api/admin/attendance/" + id), admin).content("{\"status\":\"PRESENT\",\"reason\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        mvc.perform(auth(put("/api/admin/attendance/" + id), admin)
                        .content("{\"status\":\"PRESENT\",\"reason\":\"Confirmed by the ASM on a call\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correctionReason").value("Confirmed by the ASM on a call"));

        mvc.perform(auth(get("/api/admin/audit-logs?action=ATTENDANCE_CORRECTION"), admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].description", containsString("Confirmed by the ASM on a call")));
    }

    // ------------------------------------------------------------------ misc
    @Test
    void passwordChangeRequiresTheCurrentPassword() throws Exception {
        String t = login("marketing01", "password123");
        mvc.perform(auth(post("/api/auth/change-password"), t)
                        .content("{\"currentPassword\":\"wrong\",\"newPassword\":\"BrandNew#123\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("WRONG_CURRENT_PASSWORD"));
        mvc.perform(auth(post("/api/auth/change-password"), t)
                        .content("{\"currentPassword\":\"password123\",\"newPassword\":\"BrandNew#123\"}"))
                .andExpect(status().isNoContent());
        // put it back so other tests are unaffected
        String t2 = login("marketing01", "BrandNew#123");
        mvc.perform(auth(post("/api/auth/change-password"), t2)
                .content("{\"currentPassword\":\"BrandNew#123\",\"newPassword\":\"password123\"}")).andExpect(status().isNoContent());
    }

    @Test
    void swaggerUiIsReachableWithoutLogin() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andExpect(jsonPath("$.info.title", startsWith("Staff Attendance")));
    }
}
