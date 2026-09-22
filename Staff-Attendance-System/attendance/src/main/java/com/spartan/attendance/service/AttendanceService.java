package com.spartan.attendance.service;

import com.spartan.attendance.config.AppProperties;
import com.spartan.attendance.dto.AttendanceResponse;
import com.spartan.attendance.dto.CorrectionRequest;
import com.spartan.attendance.dto.GpsRequest;
import com.spartan.attendance.dto.SettingsResponse;
import com.spartan.attendance.dto.SummaryResponse;
import com.spartan.attendance.dto.TodayResponse;
import com.spartan.attendance.dto.WorkLocationResponse;
import com.spartan.attendance.entity.Attendance;
import com.spartan.attendance.entity.AttendanceStatus;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.entity.WorkLocation;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.AttendanceRepository;
import com.spartan.attendance.repository.ShopRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.repository.WorkLocationRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.AttendanceRules;
import com.spartan.attendance.util.GeoUtil;
import com.spartan.attendance.util.RequestInfo;
import jakarta.persistence.criteria.Predicate;
import java.io.IOException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * GPS attendance. Everything that decides validity happens here, on the server:
 * identity (from the JWT principal), GPS sanity + accuracy, Haversine distance to the work location,
 * duplicate protection, working-minute maths and late/half-day classification.
 */
@Service
@RequiredArgsConstructor
public class AttendanceService {

    private static final int MAX_RANGE_DAYS = 400;

    private final AttendanceRepository attendanceRepository;
    private final UserRepository userRepository;
    private final WorkLocationRepository workLocationRepository;
    private final ShopRepository shopRepository;
    private final PhotoStorage photoStorage;
    private final ScopeService scopeService;
    private final AuditService auditService;
    private final AppProperties props;
    private final Clock clock;

    private record GeoMatch(WorkLocation location, double distanceMeters) {
    }

    /** A stored check-in photo, ready to be sent to the browser. */
    public record PhotoContent(byte[] bytes, String contentType) {
    }

    // =====================================================================================
    // Check in / out
    // =====================================================================================

    @Transactional
    public AttendanceResponse checkIn(AppUserDetails caller, GpsRequest gps, RequestInfo info) {
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDate today = now.toLocalDate();
        User user = userRepository.findById(caller.getId()).orElseThrow();
        if (user.getRole() == Role.SO) {
            throw ApiException.badRequest("SHOP_CHECKIN_REQUIRED",
                    "Sales Officers mark attendance at one of their assigned shops, with a live photo of the shop.");
        }

        if (attendanceRepository.findForUserOnDate(user.getId(), today).isPresent()) {
            throw ApiException.conflict("ALREADY_CHECKED_IN", "You have already checked in today.");
        }
        GeoMatch match = validateGps(gps);

        AppProperties.Attendance cfg = props.getAttendance();
        boolean late = AttendanceRules.isLate(now.toLocalTime(), cfg.getShiftStart(), cfg.getLateGraceMinutes());
        Attendance a = Attendance.builder()
                .user(user)
                .attendanceDate(today)
                .checkInTime(now)
                .checkInLatitude(gps.latitude())
                .checkInLongitude(gps.longitude())
                .checkInAccuracy(gps.accuracy())
                .checkInDistanceMeters(round1(match.distanceMeters()))
                .status(late ? AttendanceStatus.LATE : AttendanceStatus.PRESENT)
                .workLocation(match.location())
                .deviceInfo(deviceInfo(gps, info))
                .ipAddress(info == null ? null : info.ipAddress())
                .build();
        try {
            a = attendanceRepository.saveAndFlush(a);   // the unique (user,date) key is the final guard against a double tap
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("ALREADY_CHECKED_IN", "You have already checked in today.");
        }
        auditService.log(user.getId(), AuditAction.CHECK_IN,
                String.format("Checked in at %s (%.0f m from %s, GPS accuracy %.0f m)%s", now.toLocalTime().withNano(0),
                        match.distanceMeters(), match.location().getName(), gps.accuracy(), late ? " - LATE" : ""), info);
        return AttendanceResponse.from(a, false);
    }

    /**
     * Sales Officer check-in: they must be at one of THEIR assigned shops. The server checks who they are (JWT), that the
     * shop is theirs and active, that the GPS fix is good enough, that they are within the shop's radius (Haversine), and
     * that a real image was uploaded. Nothing about location or identity is taken on trust from the browser.
     */
    @Transactional
    public AttendanceResponse shopCheckIn(AppUserDetails caller, Long shopId, GpsRequest gps, MultipartFile photo, RequestInfo info) {
        if (caller.getRole() != Role.SO) {
            throw ApiException.forbidden("SHOP_CHECKIN_SO_ONLY", "Only Sales Officers mark attendance at a shop.");
        }
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDate today = now.toLocalDate();
        User user = userRepository.findById(caller.getId()).orElseThrow();
        if (attendanceRepository.findForUserOnDate(user.getId(), today).isPresent()) {
            throw ApiException.conflict("ALREADY_CHECKED_IN", "You have already checked in today.");
        }
        Shop shop = shopRepository.findById(shopId).orElseThrow(() -> ApiException.notFound("Shop not found."));
        if (shop.getStatus() != Status.ACTIVE || shop.getAssignedOfficer() == null
                || !shop.getAssignedOfficer().getId().equals(user.getId())) {
            throw ApiException.forbidden("SHOP_NOT_ASSIGNED", "That shop is not assigned to you.");
        }

        validateFix(gps);
        double distance = GeoUtil.haversineMeters(gps.latitude(), gps.longitude(), shop.getLatitude(), shop.getLongitude());
        if (distance > shop.getAllowedRadiusMeters()) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("distanceMeters", Math.round(distance));
            d.put("allowedRadiusMeters", shop.getAllowedRadiusMeters());
            d.put("shopId", shop.getId());
            d.put("shopName", shop.getName());
            throw ApiException.badRequest("OUTSIDE_GEOFENCE",
                    String.format("You are %d m from %s. Attendance is only allowed within %d m of the shop.",
                            Math.round(distance), shop.getName(), shop.getAllowedRadiusMeters()), d);
        }

        if (photo == null || photo.isEmpty()) {
            throw ApiException.badRequest("PHOTO_REQUIRED", "A live photo of the shop is required to mark attendance.");
        }
        if (photo.getSize() > props.getAttendance().getMaxPhotoBytes()) {
            throw ApiException.badRequest("PHOTO_TOO_LARGE", "That photo is too large. Retake it or choose a smaller image.");
        }
        byte[] bytes;
        try {
            bytes = photo.getBytes();
        } catch (IOException e) {
            throw ApiException.badRequest("INVALID_PHOTO", "The photo could not be read. Please retake it.");
        }
        String extension = PhotoStorage.detectExtension(bytes);
        if (extension == null) {
            throw ApiException.badRequest("INVALID_PHOTO", "The photo must be a JPEG, PNG or WebP image.");
        }
        String photoFile;
        try {
            photoFile = photoStorage.save(bytes, extension);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PHOTO_STORAGE_FAILED",
                    "The photo could not be saved on the server. Please try again.", null);
        }

        try {
            AppProperties.Attendance cfg = props.getAttendance();
            boolean late = AttendanceRules.isLate(now.toLocalTime(), cfg.getShiftStart(), cfg.getLateGraceMinutes());
            Attendance a = Attendance.builder()
                    .user(user)
                    .attendanceDate(today)
                    .checkInTime(now)
                    .checkInLatitude(gps.latitude())
                    .checkInLongitude(gps.longitude())
                    .checkInAccuracy(gps.accuracy())
                    .checkInDistanceMeters(round1(distance))
                    .status(late ? AttendanceStatus.LATE : AttendanceStatus.PRESENT)
                    .shop(shop)
                    .checkInPhoto(photoFile)
                    .deviceInfo(deviceInfo(gps, info))
                    .ipAddress(info == null ? null : info.ipAddress())
                    .build();
            try {
                a = attendanceRepository.saveAndFlush(a);   // the unique (user,date) key is the final guard against a double tap
            } catch (DataIntegrityViolationException e) {
                throw ApiException.conflict("ALREADY_CHECKED_IN", "You have already checked in today.");
            }
            auditService.log(user.getId(), AuditAction.CHECK_IN,
                    String.format("Checked in at %s at shop %s '%s' (%.0f m away, GPS accuracy %.0f m, live photo saved)%s",
                            now.toLocalTime().withNano(0), shop.getCode(), shop.getName(), distance, gps.accuracy(),
                            late ? " - LATE" : ""), info);
            return AttendanceResponse.from(a, false);
        } catch (RuntimeException e) {
            photoStorage.deleteQuietly(photoFile);          // no record was created, so do not keep an orphan photo
            throw e;
        }
    }

    @Transactional
    public AttendanceResponse checkOut(AppUserDetails caller, GpsRequest gps, RequestInfo info) {
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDate today = now.toLocalDate();

        Attendance a = attendanceRepository.findForUserOnDate(caller.getId(), today)
                .orElseThrow(() -> ApiException.badRequest("NOT_CHECKED_IN",
                        "You have not checked in today, so there is nothing to check out of."));
        if (a.getCheckOutTime() != null) {
            throw ApiException.conflict("ALREADY_CHECKED_OUT", "You have already checked out today.");
        }
        // A Sales Officer works in the field and may finish the day anywhere: only a trustworthy GPS fix is required (it is
        // recorded). Everyone else must be inside a work location, exactly as at check-in.
        GeoMatch match = caller.getRole() == Role.SO ? null : validateGps(gps);
        if (match == null) {
            validateFix(gps);
        }

        int minutes = AttendanceRules.workingMinutes(a.getCheckInTime(), now);
        a.setCheckOutTime(now);
        a.setCheckOutLatitude(gps.latitude());
        a.setCheckOutLongitude(gps.longitude());
        a.setCheckOutAccuracy(gps.accuracy());
        a.setCheckOutDistanceMeters(match == null ? null : round1(match.distanceMeters()));
        a.setTotalWorkingMinutes(minutes);
        if (a.getStatus() != AttendanceStatus.ABSENT && AttendanceRules.isHalfDay(minutes, props.getAttendance().getHalfDayMinutes())) {
            a.setStatus(AttendanceStatus.HALF_DAY);
        }
        a = attendanceRepository.save(a);
        auditService.log(caller.getId(), AuditAction.CHECK_OUT,
                match == null
                        ? String.format("Checked out at %s after %s (GPS accuracy %.0f m)", now.toLocalTime().withNano(0),
                                AttendanceRules.formatMinutes(minutes), gps.accuracy())
                        : String.format("Checked out at %s after %s (%.0f m from %s)", now.toLocalTime().withNano(0),
                                AttendanceRules.formatMinutes(minutes), match.distanceMeters(), match.location().getName()), info);
        return AttendanceResponse.from(a, false);
    }

    /**
     * The one GPS gate used by both check-in and check-out:
     * plausible fix -> accuracy good enough -> inside an ACTIVE work location's radius (Haversine, server-side).
     */
    private GeoMatch validateGps(GpsRequest gps) {
        validateFix(gps);
        double lat = gps.latitude();
        double lon = gps.longitude();

        List<WorkLocation> active = workLocationRepository.findByStatusOrderByNameAsc(Status.ACTIVE);
        if (active.isEmpty()) {
            throw ApiException.conflict("NO_WORK_LOCATION", "No active work location is set up yet. Ask your Admin to add one.");
        }

        GeoMatch inside = null;          // closest location whose radius actually contains the fix
        WorkLocation nearest = null;     // otherwise: the location we were closest to getting inside
        double nearestGap = Double.MAX_VALUE;
        double nearestDistance = 0;
        for (WorkLocation w : active) {
            double d = GeoUtil.haversineMeters(lat, lon, w.getLatitude(), w.getLongitude());
            if (d <= w.getAllowedRadiusMeters() && (inside == null || d < inside.distanceMeters())) {
                inside = new GeoMatch(w, d);
            }
            double gap = d - w.getAllowedRadiusMeters();
            if (gap < nearestGap) {
                nearestGap = gap;
                nearest = w;
                nearestDistance = d;
            }
        }
        if (inside != null) {
            return inside;
        }
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("distanceMeters", Math.round(nearestDistance));
        d.put("allowedRadiusMeters", nearest.getAllowedRadiusMeters());
        d.put("workLocationId", nearest.getId());
        d.put("workLocationName", nearest.getName());
        throw ApiException.badRequest("OUTSIDE_GEOFENCE",
                String.format("You are %d m from %s. Attendance is only allowed within %d m.",
                        Math.round(nearestDistance), nearest.getName(), nearest.getAllowedRadiusMeters()), d);
    }

    /** A plausible position (not 0,0 / NaN / out of range) with an accuracy the policy accepts. Used by every check-in and check-out. */
    private void validateFix(GpsRequest gps) {
        double lat = gps.latitude();
        double lon = gps.longitude();
        double accuracy = gps.accuracy();

        if (!GeoUtil.isPlausibleFix(lat, lon) || Double.isNaN(accuracy) || accuracy < 0) {
            throw ApiException.badRequest("INVALID_GPS", "The GPS position received is not valid. Turn on location and try again.");
        }
        double maxAccuracy = props.getAttendance().getMaxAccuracyMeters();
        if (accuracy > maxAccuracy) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("accuracyMeters", round1(accuracy));
            d.put("maxAccuracyMeters", maxAccuracy);
            throw ApiException.badRequest("POOR_GPS_ACCURACY",
                    String.format("GPS accuracy is too low (about %.0f m). Move to an open area and try again - %.0f m or better is needed.",
                            accuracy, maxAccuracy), d);
        }
    }

    // =====================================================================================
    // Reading
    // =====================================================================================

    /** The live photo of a check-in. Same visibility rule as the record itself: the person, their managers, Owner and Admin. */
    @Transactional(readOnly = true)
    public PhotoContent photo(AppUserDetails caller, Long attendanceId) {
        Attendance a = attendanceRepository.findById(attendanceId)
                .orElseThrow(() -> ApiException.notFound("Attendance record not found."));
        scopeService.assertVisible(caller, a.getUser().getId());
        if (a.getCheckInPhoto() == null) {
            throw ApiException.notFound("There is no photo for this record.");
        }
        byte[] bytes;
        try {
            bytes = photoStorage.read(a.getCheckInPhoto());
        } catch (IOException e) {
            throw ApiException.notFound("The photo could not be read.");
        }
        if (bytes == null) {
            throw ApiException.notFound("The photo file is no longer available.");
        }
        return new PhotoContent(bytes, PhotoStorage.contentTypeFor(a.getCheckInPhoto()));
    }

    @Transactional(readOnly = true)
    public TodayResponse today(AppUserDetails caller) {
        LocalDate today = LocalDate.now(clock);
        Attendance a = attendanceRepository.findForUserOnDate(caller.getId(), today).orElse(null);
        String state = a == null ? "NOT_CHECKED_IN" : (a.getCheckOutTime() == null ? "CHECKED_IN" : "COMPLETED");
        List<WorkLocationResponse> locations = workLocationRepository.findByStatusOrderByNameAsc(Status.ACTIVE)
                .stream().map(WorkLocationResponse::from).toList();
        return new TodayResponse(today, state, a == null ? null : AttendanceResponse.from(a, false), locations,
                props.getAttendance().getMaxAccuracyMeters());
    }

    /** The caller's OWN history - the user id comes from the token, there is no userId parameter to tamper with. */
    @Transactional(readOnly = true)
    public List<AttendanceResponse> my(AppUserDetails caller, LocalDate from, LocalDate to, AttendanceStatus status) {
        LocalDate end = to == null ? LocalDate.now(clock) : to;
        LocalDate start = from == null ? end.minusDays(29) : from;
        checkRange(start, end);
        Specification<Attendance> spec = (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("user").get("id"), caller.getId()));
            p.add(cb.greaterThanOrEqualTo(root.<LocalDate>get("attendanceDate"), start));
            p.add(cb.lessThanOrEqualTo(root.<LocalDate>get("attendanceDate"), end));
            if (status != null) {
                p.add(cb.equal(root.get("status"), status));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        return attendanceRepository.findAll(spec, Sort.by(Sort.Direction.DESC, "attendanceDate")).stream()
                .map(a -> AttendanceResponse.from(a, false)).toList();
    }

    /**
     * Team / admin report. The caller's scope is applied to the query itself:
     * ADMIN + OWNER see everyone, RSM/RM/ASM their reporting tree, and asking for someone outside it is a 403.
     */
    @Transactional(readOnly = true)
    public List<AttendanceResponse> report(AppUserDetails caller, LocalDate from, LocalDate to, Long userId, Role role,
                                           AttendanceStatus status, Long workLocationId) {
        LocalDate end = to == null ? LocalDate.now(clock) : to;
        LocalDate start = from == null ? end : from;
        checkRange(start, end);
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        if (userId != null && !scope.contains(userId)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only view people who report to you.");
        }
        Specification<Attendance> spec = (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.greaterThanOrEqualTo(root.<LocalDate>get("attendanceDate"), start));
            p.add(cb.lessThanOrEqualTo(root.<LocalDate>get("attendanceDate"), end));
            if (!scope.all()) {
                p.add(root.get("user").get("id").in(scope.ids()));
            }
            if (userId != null) {
                p.add(cb.equal(root.get("user").get("id"), userId));
            }
            if (role != null) {
                p.add(cb.equal(root.get("user").get("role"), role));
            }
            if (status != null) {
                p.add(cb.equal(root.get("status"), status));
            }
            if (workLocationId != null) {
                p.add(cb.equal(root.get("workLocation").get("id"), workLocationId));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        boolean technical = caller.getRole() == Role.ADMIN;
        return attendanceRepository.findAll(spec, Sort.by(Sort.Direction.DESC, "attendanceDate")).stream()
                .sorted((x, y) -> {
                    int byDate = y.getAttendanceDate().compareTo(x.getAttendanceDate());
                    return byDate != 0 ? byDate : x.getUser().getName().compareToIgnoreCase(y.getUser().getName());
                })
                .map(a -> AttendanceResponse.from(a, technical)).toList();
    }

    /**
     * Present = PRESENT + LATE days. Late = the LATE subset (already inside Present). Half day = HALF_DAY records.
     * Absent = working days (weekly-off excluded, days before the account existed excluded, today excluded until
     * the person has a record) with no attendance. Employees counted: ACTIVE, non-ADMIN, inside the caller's scope.
     */
    @Transactional(readOnly = true)
    public SummaryResponse summary(AppUserDetails caller, LocalDate from, LocalDate to, Long userId, Role role) {
        LocalDate today = LocalDate.now(clock);
        LocalDate end = to == null ? today : to;
        LocalDate start = from == null ? end.withDayOfMonth(1) : from;
        checkRange(start, end);
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        if (userId != null && !scope.contains(userId)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only view people who report to you.");
        }
        List<User> employees = userRepository.findAllWithManager().stream()
                .filter(u -> scope.contains(u.getId()))
                .filter(u -> u.getRole() != Role.ADMIN && u.getStatus() == Status.ACTIVE)
                .filter(u -> userId == null || u.getId().equals(userId))
                .filter(u -> role == null || u.getRole() == role)
                .toList();

        Map<Long, List<Attendance>> byUser = new HashMap<>();
        if (!employees.isEmpty()) {
            List<Long> ids = employees.stream().map(User::getId).toList();
            Specification<Attendance> spec = (root, q, cb) -> cb.and(
                    cb.greaterThanOrEqualTo(root.<LocalDate>get("attendanceDate"), start),
                    cb.lessThanOrEqualTo(root.<LocalDate>get("attendanceDate"), end),
                    root.get("user").get("id").in(ids));
            for (Attendance a : attendanceRepository.findAll(spec, Sort.by("attendanceDate"))) {
                byUser.computeIfAbsent(a.getUser().getId(), k -> new ArrayList<>()).add(a);
            }
        }

        var weeklyOff = props.getAttendance().getWeeklyOff();
        LocalDate effectiveEnd = end.isAfter(today) ? today : end;
        List<SummaryResponse.EmployeeSummary> rows = new ArrayList<>();
        int present = 0;
        int absent = 0;
        int late = 0;
        int half = 0;
        long minutes = 0;
        for (User u : employees) {
            List<Attendance> records = byUser.getOrDefault(u.getId(), List.of());
            LocalDate joined = u.getCreatedAt().toLocalDate();
            LocalDate personStart = start.isBefore(joined) ? joined : start;
            int expected = AttendanceRules.countWorkingDays(personStart, effectiveEnd, weeklyOff);
            boolean hasToday = records.stream().anyMatch(r -> r.getAttendanceDate().equals(today));
            if (effectiveEnd.equals(today) && !today.isBefore(personStart) && !hasToday
                    && today.getDayOfWeek() != weeklyOff) {
                expected -= 1;           // today is not over yet, so nobody is "absent" today
            }
            int p = 0;
            int l = 0;
            int h = 0;
            int attendedWorkingDays = 0;
            long m = 0;
            for (Attendance r : records) {
                switch (r.getStatus()) {
                    case PRESENT -> p++;
                    case LATE -> {
                        p++;
                        l++;
                    }
                    case HALF_DAY -> h++;
                    default -> { }
                }
                if (r.getStatus() != AttendanceStatus.ABSENT && r.getAttendanceDate().getDayOfWeek() != weeklyOff) {
                    attendedWorkingDays++;
                }
                if (r.getTotalWorkingMinutes() != null) {
                    m += r.getTotalWorkingMinutes();
                }
            }
            int a = Math.max(0, expected - attendedWorkingDays);
            rows.add(new SummaryResponse.EmployeeSummary(u.getId(), u.getEmployeeCode(), u.getName(), u.getRole(),
                    Math.max(expected, 0), p, a, l, h, m, hours(m)));
            present += p;
            absent += a;
            late += l;
            half += h;
            minutes += m;
        }
        return new SummaryResponse(start, end, AttendanceRules.countWorkingDays(start, effectiveEnd, weeklyOff),
                present, absent, late, half, minutes, hours(minutes), rows);
    }

    public SettingsResponse settings() {
        AppProperties.Attendance c = props.getAttendance();
        return new SettingsResponse(c.getZone(), c.getShiftStart().toString(), c.getLateGraceMinutes(),
                c.getHalfDayMinutes(), c.getMaxAccuracyMeters(), c.getWeeklyOff().name());
    }

    // =====================================================================================
    // Admin corrections (never silent: reason mandatory, before/after written to the audit log)
    // =====================================================================================

    @Transactional
    public AttendanceResponse correct(AppUserDetails admin, Long attendanceId, CorrectionRequest req, RequestInfo info) {
        Attendance a = attendanceRepository.findById(attendanceId)
                .orElseThrow(() -> ApiException.notFound("Attendance record not found."));
        String before = describe(a);
        applyTimes(a, req);
        a.setCorrectionReason(req.reason().trim());
        a.setCorrectedBy(admin.getId());
        a.setCorrectedAt(LocalDateTime.now(clock));
        a = attendanceRepository.save(a);
        auditService.log(admin.getId(), AuditAction.ATTENDANCE_CORRECTION,
                "Corrected attendance #" + a.getId() + " of " + a.getUser().getEmployeeCode() + " on " + a.getAttendanceDate()
                        + ": [" + before + "] -> [" + describe(a) + "]. Reason: " + req.reason().trim(), info);
        return AttendanceResponse.from(a, true);
    }

    /** Manual entry for a day that has no record at all (e.g. the person could not use the app). */
    @Transactional
    public AttendanceResponse createManual(AppUserDetails admin, CorrectionRequest req, RequestInfo info) {
        if (req.userId() == null || req.date() == null) {
            throw ApiException.badRequest("VALIDATION_FAILED", "userId and date are required for a manual entry.");
        }
        if (req.date().isAfter(LocalDate.now(clock))) {
            throw ApiException.badRequest("FUTURE_DATE", "You cannot create attendance for a future date.");
        }
        User user = userRepository.findById(req.userId()).orElseThrow(() -> ApiException.notFound("User not found."));
        if (attendanceRepository.findForUserOnDate(user.getId(), req.date()).isPresent()) {
            throw ApiException.conflict("ALREADY_EXISTS", "That person already has a record for this date - correct it instead.");
        }
        Attendance a = Attendance.builder()
                .user(user)
                .attendanceDate(req.date())
                .status(req.status() == null ? AttendanceStatus.PRESENT : req.status())
                .build();
        applyTimes(a, req);
        a.setCorrectionReason(req.reason().trim());
        a.setCorrectedBy(admin.getId());
        a.setCorrectedAt(LocalDateTime.now(clock));
        a = attendanceRepository.save(a);
        auditService.log(admin.getId(), AuditAction.ATTENDANCE_CORRECTION,
                "Manually created attendance #" + a.getId() + " for " + user.getEmployeeCode() + " on " + a.getAttendanceDate()
                        + ": [" + describe(a) + "]. Reason: " + req.reason().trim(), info);
        return AttendanceResponse.from(a, true);
    }

    private void applyTimes(Attendance a, CorrectionRequest req) {
        LocalDate date = a.getAttendanceDate();
        if (date.isAfter(LocalDate.now(clock))) {
            throw ApiException.badRequest("FUTURE_DATE", "You cannot correct attendance for a future date.");
        }
        if (req.checkInTime() != null) {
            if (!req.checkInTime().toLocalDate().equals(date)) {
                throw ApiException.badRequest("DATE_MISMATCH", "Check-in time must be on " + date + ".");
            }
            a.setCheckInTime(req.checkInTime());
        }
        if (req.checkOutTime() != null) {
            if (!req.checkOutTime().toLocalDate().equals(date)) {
                throw ApiException.badRequest("DATE_MISMATCH", "Check-out time must be on " + date + ".");
            }
            a.setCheckOutTime(req.checkOutTime());
        }
        if (a.getCheckOutTime() != null && a.getCheckInTime() == null) {
            throw ApiException.badRequest("CHECKOUT_WITHOUT_CHECKIN", "A check-out needs a check-in time.");
        }
        if (a.getCheckInTime() != null && a.getCheckOutTime() != null) {
            if (a.getCheckOutTime().isBefore(a.getCheckInTime())) {
                throw ApiException.badRequest("TIME_ORDER", "Check-out cannot be earlier than check-in.");
            }
            a.setTotalWorkingMinutes(AttendanceRules.workingMinutes(a.getCheckInTime(), a.getCheckOutTime()));
        }
        if (req.status() != null) {
            a.setStatus(req.status());
        } else if (req.checkInTime() != null || req.checkOutTime() != null) {
            AppProperties.Attendance cfg = props.getAttendance();
            AttendanceStatus s = a.getCheckInTime() != null
                    && AttendanceRules.isLate(a.getCheckInTime().toLocalTime(), cfg.getShiftStart(), cfg.getLateGraceMinutes())
                    ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
            if (a.getTotalWorkingMinutes() != null && a.getCheckOutTime() != null
                    && AttendanceRules.isHalfDay(a.getTotalWorkingMinutes(), cfg.getHalfDayMinutes())) {
                s = AttendanceStatus.HALF_DAY;
            }
            a.setStatus(s);
        }
    }

    // =====================================================================================
    // helpers
    // =====================================================================================

    private void checkRange(LocalDate from, LocalDate to) {
        if (to.isBefore(from)) {
            throw ApiException.badRequest("INVALID_RANGE", "'from' must not be after 'to'.");
        }
        if (from.plusDays(MAX_RANGE_DAYS).isBefore(to)) {
            throw ApiException.badRequest("RANGE_TOO_LARGE", "Please choose a range of at most " + MAX_RANGE_DAYS + " days.");
        }
    }

    private static String describe(Attendance a) {
        return "in=" + (a.getCheckInTime() == null ? "-" : a.getCheckInTime().toLocalTime().withNano(0))
                + ", out=" + (a.getCheckOutTime() == null ? "-" : a.getCheckOutTime().toLocalTime().withNano(0))
                + ", minutes=" + a.getTotalWorkingMinutes() + ", status=" + a.getStatus();
    }

    private static String deviceInfo(GpsRequest gps, RequestInfo info) {
        String d = gps.deviceInfo() != null && !gps.deviceInfo().isBlank() ? gps.deviceInfo() : (info == null ? null : info.userAgent());
        return d == null ? null : (d.length() > 255 ? d.substring(0, 255) : d);
    }

    private static String hours(long minutes) {
        return AttendanceRules.formatMinutes((int) Math.min(minutes, Integer.MAX_VALUE));
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
