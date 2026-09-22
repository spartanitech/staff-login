package com.spartan.attendance.controller;

import com.spartan.attendance.dto.AttendanceResponse;
import com.spartan.attendance.dto.GpsRequest;
import com.spartan.attendance.dto.SummaryResponse;
import com.spartan.attendance.dto.TodayResponse;
import com.spartan.attendance.entity.AttendanceStatus;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.AttendanceService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/attendance")
@RequiredArgsConstructor
@Tag(name = "Attendance (GPS)", description = "Check-in / check-out with server-side geofence validation, history and summaries")
public class AttendanceController {

    private final AttendanceService service;

    @Operation(summary = "CHECK IN. Body = the device's GPS fix. The user comes from the JWT; the backend validates accuracy + geofence.")
    @PostMapping("/check-in")
    @ResponseStatus(HttpStatus.CREATED)
    public AttendanceResponse checkIn(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody GpsRequest gps,
                                      HttpServletRequest http) {
        return service.checkIn(caller, gps, RequestInfo.from(http));
    }

    @Operation(summary = "SALES OFFICER check-in at an assigned shop. Multipart: shopId, latitude, longitude, accuracy, photo (live photo). "
            + "The backend validates who you are, that the shop is yours, GPS accuracy, the distance to the shop and the image.")
    @PreAuthorize("hasRole('SO')")
    @PostMapping(value = "/shop-check-in", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public AttendanceResponse shopCheckIn(@AuthenticationPrincipal AppUserDetails caller,
                                          @RequestParam Long shopId, @RequestParam Double latitude,
                                          @RequestParam Double longitude, @RequestParam Double accuracy,
                                          @RequestParam(required = false) String deviceInfo,
                                          @RequestParam(value = "photo", required = false) MultipartFile photo,
                                          HttpServletRequest http) {
        return service.shopCheckIn(caller, shopId, new GpsRequest(latitude, longitude, accuracy, deviceInfo), photo,
                RequestInfo.from(http));
    }

    @Operation(summary = "The live photo taken at check-in. Visible to the person, their managers, Owner and Admin only.")
    @GetMapping("/{id}/photo")
    public ResponseEntity<byte[]> photo(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        AttendanceService.PhotoContent p = service.photo(caller, id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(p.contentType()))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePrivate())
                .body(p.bytes());
    }

    @Operation(summary = "CHECK OUT. Same GPS validation as check-in; needs an open check-in for today.")
    @PostMapping("/check-out")
    public AttendanceResponse checkOut(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody GpsRequest gps,
                                       HttpServletRequest http) {
        return service.checkOut(caller, gps, RequestInfo.from(http));
    }

    @Operation(summary = "Today's state for the signed-in user: NOT_CHECKED_IN | CHECKED_IN | COMPLETED, plus active work locations")
    @GetMapping("/today")
    public TodayResponse today(@AuthenticationPrincipal AppUserDetails caller) {
        return service.today(caller);
    }

    @Operation(summary = "My own attendance history (defaults to the last 30 days)")
    @GetMapping("/my")
    public List<AttendanceResponse> my(@AuthenticationPrincipal AppUserDetails caller,
                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                       @RequestParam(required = false) AttendanceStatus status) {
        return service.my(caller, from, to, status);
    }

    @Tag(name = "Reports")
    @Operation(summary = "Team attendance. ADMIN/OWNER: everyone. RSM/RM/ASM: only people who report to them. SO: 403.")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER','RSM','RM','ASM')")
    @GetMapping("/team")
    public List<AttendanceResponse> team(@AuthenticationPrincipal AppUserDetails caller,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                         @RequestParam(required = false) Long userId,
                                         @RequestParam(required = false) Role role,
                                         @RequestParam(required = false) AttendanceStatus status,
                                         @RequestParam(required = false) Long workLocationId) {
        return service.report(caller, from, to, userId, role, status, workLocationId);
    }

    @Tag(name = "Reports")
    @Operation(summary = "Working days / present / absent / late / half day / total hours. SO: own numbers; managers: their tree; ADMIN/OWNER: all.")
    @GetMapping("/summary")
    public SummaryResponse summary(@AuthenticationPrincipal AppUserDetails caller,
                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                   @RequestParam(required = false) Long userId,
                                   @RequestParam(required = false) Role role) {
        return service.summary(caller, from, to, userId, role);
    }
}
