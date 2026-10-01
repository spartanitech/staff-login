package com.spartan.attendance.controller;

import com.spartan.attendance.dto.DailyReportRequest;
import com.spartan.attendance.dto.DailyReportResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.DailyReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/daily-reports")
@RequiredArgsConstructor
@Tag(name = "Daily Shop Report", description = "A Sales Officer's Daily Shop Report, one per day, readable by their managers.")
public class DailyReportController {

    private final DailyReportService service;

    @Operation(summary = "The report of one day (default: mine, today). Managers may pass officerId from their team.")
    @GetMapping
    public DailyReportResponse get(@AuthenticationPrincipal AppUserDetails caller,
                                   @RequestParam(required = false) Long officerId,
                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.get(caller, officerId, date);
    }

    @Operation(summary = "Reports between two dates (at most 62 days)")
    @GetMapping("/range")
    public List<DailyReportResponse> range(@AuthenticationPrincipal AppUserDetails caller,
                                           @RequestParam(required = false) Long officerId,
                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.range(caller, officerId, from, to);
    }

    @Operation(summary = "Save my report for one day (Sales Officer)")
    @PutMapping("/{date}")
    public DailyReportResponse save(@AuthenticationPrincipal AppUserDetails caller,
                                    @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                    @Valid @RequestBody DailyReportRequest request) {
        return service.save(caller, date, request);
    }
}
