package com.spartan.attendance.service;

import com.spartan.attendance.config.AppProperties;
import com.spartan.attendance.dto.AttendanceResponse;
import com.spartan.attendance.dto.GpsRequest;
import com.spartan.attendance.entity.Attendance;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.ShopVisit;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.AttendanceRepository;
import com.spartan.attendance.repository.ShopRepository;
import com.spartan.attendance.repository.ShopVisitRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.GeoUtil;
import com.spartan.attendance.util.RequestInfo;
import java.io.IOException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Every shop a Sales Officer visits in a day. The first visit is also the day's attendance check-in (done by
 * AttendanceService.shopCheckIn, unchanged); each later shop is checked the same way (shop is theirs, good GPS fix,
 * inside the shop's radius, live photo) and stored as another visit. Managers read the visits of their own team only.
 */
@Service
@RequiredArgsConstructor
public class ShopVisitService {

    private static final int MAX_RANGE_DAYS = 400;

    private final ShopVisitRepository repository;
    private final AttendanceService attendanceService;
    private final AttendanceRepository attendanceRepository;
    private final ShopRepository shopRepository;
    private final UserRepository userRepository;
    private final PhotoStorage photoStorage;
    private final ScopeService scopeService;
    private final AppProperties props;
    private final Clock clock;

    public record VisitResponse(Long id, Long officerId, String officerName, Long attendanceId, Long shopId, String shopName,
                                LocalDate date, LocalDateTime visitTime, double latitude, double longitude, double accuracy,
                                double distanceMeters, int allowedRadiusMeters, boolean firstOfDay, boolean hasPhoto,
                                int visitNumber, AttendanceResponse attendance) {
    }

    /** Records one shop visit. The first one of the day also marks attendance. */
    @Transactional
    public VisitResponse visit(AppUserDetails caller, Long shopId, GpsRequest gps, MultipartFile photo, RequestInfo info) {
        if (caller.getRole() != Role.SO) {
            throw ApiException.forbidden("SHOP_CHECKIN_SO_ONLY", "Only Sales Officers mark attendance at a shop.");
        }
        if (shopId == null) {
            throw ApiException.badRequest("SHOP_REQUIRED", "Choose the shop you are at.");
        }
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDate today = now.toLocalDate();
        User user = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        Attendance existing = attendanceRepository.findForUserOnDate(user.getId(), today).orElse(null);

        if (existing == null) {
            // first shop of the day = the attendance check-in (all of its checks and its photo handling)
            AttendanceResponse att = attendanceService.shopCheckIn(caller, shopId, gps, photo, info);
            Attendance a = attendanceRepository.findById(att.id()).orElseThrow();
            Shop shop = a.getShop();
            ShopVisit v = repository.save(ShopVisit.builder()
                    .officer(user).attendanceId(a.getId())
                    .shopId(shop == null ? shopId : shop.getId())
                    .shopName(shop == null ? "" : shop.getName())
                    .visitDate(today).visitTime(a.getCheckInTime() == null ? now : a.getCheckInTime())
                    .latitude(gps.latitude()).longitude(gps.longitude()).accuracy(gps.accuracy())
                    .distanceMeters(a.getCheckInDistanceMeters() == null ? 0 : a.getCheckInDistanceMeters())
                    .allowedRadiusMeters(shop == null ? 0 : shop.getAllowedRadiusMeters())
                    .photo(a.getCheckInPhoto())
                    .firstOfDay(true)
                    .build());
            return toResponse(v, 1, att);
        }

        // a later shop: the same proof as the check-in, stored as one more visit
        Shop shop = shopRepository.findById(shopId).orElseThrow(() -> ApiException.notFound("Shop not found."));
        if (!ShopService.usableBy(shop, user)) {
            throw ApiException.forbidden("SHOP_NOT_ASSIGNED", "That shop is not assigned to you.");
        }
        attendanceService.validateFix(gps);
        double distance = GeoUtil.haversineMeters(gps.latitude(), gps.longitude(), shop.getLatitude(), shop.getLongitude());
        if (distance > shop.getAllowedRadiusMeters()) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("distanceMeters", Math.round(distance));
            d.put("allowedRadiusMeters", shop.getAllowedRadiusMeters());
            d.put("shopId", shop.getId());
            d.put("shopName", shop.getName());
            throw ApiException.badRequest("OUTSIDE_GEOFENCE",
                    String.format("You are %d m from %s. A visit is only recorded within %d m of the shop.",
                            Math.round(distance), shop.getName(), shop.getAllowedRadiusMeters()), d);
        }
        String photoFile = savePhoto(photo);
        try {
            ShopVisit v = repository.save(ShopVisit.builder()
                    .officer(user).attendanceId(existing.getId())
                    .shopId(shop.getId()).shopName(shop.getName())
                    .visitDate(today).visitTime(now)
                    .latitude(gps.latitude()).longitude(gps.longitude()).accuracy(gps.accuracy())
                    .distanceMeters(Math.round(distance * 10.0) / 10.0)
                    .allowedRadiusMeters(shop.getAllowedRadiusMeters())
                    .photo(photoFile)
                    .firstOfDay(false)
                    .build());
            int n = (int) repository.countByOfficerIdAndVisitDate(user.getId(), today);
            return toResponse(v, n, AttendanceResponse.from(existing, false));
        } catch (RuntimeException e) {
            photoStorage.deleteQuietly(photoFile);
            throw e;
        }
    }

    @Transactional(readOnly = true)
    public List<VisitResponse> list(AppUserDetails caller, Long officerId, LocalDate from, LocalDate to) {
        LocalDate end = to == null ? LocalDate.now(clock) : to;
        LocalDate start = from == null ? end : from;
        if (start.isAfter(end) || start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("BAD_RANGE", "Choose a range of at most " + MAX_RANGE_DAYS + " days.");
        }
        List<ShopVisit> rows;
        if (officerId != null) {
            scopeService.assertVisible(caller, officerId);
            rows = repository.findByOfficerIdInAndVisitDateBetweenOrderByVisitTimeDesc(List.of(officerId), start, end);
        } else {
            ScopeService.Scope scope = scopeService.scopeOf(caller);
            rows = scope.all()
                    ? repository.findByVisitDateBetweenOrderByVisitTimeDesc(start, end)
                    : repository.findByOfficerIdInAndVisitDateBetweenOrderByVisitTimeDesc(scope.ids(), start, end);
        }
        return rows.stream().map(v -> toResponse(v, 0, null)).toList();
    }

    @Transactional(readOnly = true)
    public AttendanceService.PhotoContent photo(AppUserDetails caller, Long visitId) {
        ShopVisit v = repository.findById(visitId).orElseThrow(() -> ApiException.notFound("Visit not found."));
        scopeService.assertVisible(caller, v.getOfficer().getId());
        if (v.getPhoto() == null) {
            throw ApiException.notFound("There is no photo for this visit.");
        }
        byte[] bytes;
        try {
            bytes = photoStorage.read(v.getPhoto());
        } catch (IOException e) {
            throw ApiException.notFound("The photo could not be read.");
        }
        if (bytes == null) {
            throw ApiException.notFound("The photo file is no longer available.");
        }
        return new AttendanceService.PhotoContent(bytes, PhotoStorage.contentTypeFor(v.getPhoto()));
    }

    private String savePhoto(MultipartFile photo) {
        if (photo == null || photo.isEmpty()) {
            throw ApiException.badRequest("PHOTO_REQUIRED", "A live photo of the shop is required for every visit.");
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
        try {
            return photoStorage.save(bytes, extension);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PHOTO_STORAGE_FAILED",
                    "The photo could not be saved on the server. Please try again.", null);
        }
    }

    private VisitResponse toResponse(ShopVisit v, int number, AttendanceResponse att) {
        User u = v.getOfficer();
        return new VisitResponse(v.getId(), u.getId(), u.getName(), v.getAttendanceId(), v.getShopId(), v.getShopName(),
                v.getVisitDate(), v.getVisitTime(), v.getLatitude(), v.getLongitude(), v.getAccuracy(), v.getDistanceMeters(),
                v.getAllowedRadiusMeters(), v.isFirstOfDay(), v.getPhoto() != null, number, att);
    }
}
