package com.spartan.attendance.controller;

import com.spartan.attendance.dto.GpsRequest;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.AttendanceService;
import com.spartan.attendance.service.ShopVisitService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/attendance")
@RequiredArgsConstructor
@Tag(name = "Shop visits", description = "Every shop a Sales Officer visits in a day (GPS + live photo). The first visit is also the attendance check-in.")
public class ShopVisitController {

    private final ShopVisitService service;

    @Operation(summary = "SALES OFFICER: record a shop visit. Multipart: shopId, latitude, longitude, accuracy, photo. "
            + "The first visit of the day also marks attendance; later shops are added as more visits.")
    @PreAuthorize("hasRole('SO')")
    @PostMapping(value = "/shop-visit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ShopVisitService.VisitResponse visit(@AuthenticationPrincipal AppUserDetails caller,
                                                @RequestParam Long shopId, @RequestParam Double latitude,
                                                @RequestParam Double longitude, @RequestParam Double accuracy,
                                                @RequestParam(required = false) String deviceInfo,
                                                @RequestParam(value = "photo", required = false) MultipartFile photo,
                                                HttpServletRequest http) {
        return service.visit(caller, shopId, new GpsRequest(latitude, longitude, accuracy, deviceInfo), photo, RequestInfo.from(http));
    }

    @Operation(summary = "Shop visits between two dates (default: today) - mine, my team's, or everyone's for Admin/Owner")
    @GetMapping("/visits")
    public List<ShopVisitService.VisitResponse> visits(@AuthenticationPrincipal AppUserDetails caller,
                                                       @RequestParam(required = false) Long officerId,
                                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.list(caller, officerId, from, to);
    }

    @Operation(summary = "The live photo of one shop visit (the officer, their managers, Owner and Admin)")
    @GetMapping("/visits/{id}/photo")
    public ResponseEntity<byte[]> photo(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        AttendanceService.PhotoContent p = service.photo(caller, id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(p.contentType()))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePrivate())
                .body(p.bytes());
    }
}
