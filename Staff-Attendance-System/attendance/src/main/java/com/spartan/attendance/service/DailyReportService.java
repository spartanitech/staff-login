package com.spartan.attendance.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spartan.attendance.dto.DailyReportRequest;
import com.spartan.attendance.dto.DailyReportResponse;
import com.spartan.attendance.entity.DailyReport;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.DailyReportRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Daily Shop Report kept on the server, so it is the same on every device and the ASM can read it. Only the Sales
 * Officer writes their own report; managers read the reports of their own team.
 */
@Service
@RequiredArgsConstructor
public class DailyReportService {

    /** Header + rows together; three photos scaled to ~900 px JPEG stay well under this. */
    private static final int MAX_JSON_CHARS = 4_000_000;
    private static final int MAX_RANGE_DAYS = 62;
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() { };

    private final DailyReportRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public DailyReportResponse get(AppUserDetails caller, Long officerId, LocalDate date) {
        Long who = officerId == null ? caller.getId() : officerId;
        scopeService.assertVisible(caller, who);
        LocalDate day = date == null ? today() : date;
        return repository.findByOfficerIdAndReportDate(who, day)
                .map(this::toResponse)
                .orElseGet(() -> new DailyReportResponse(who, day, new LinkedHashMap<>(), new LinkedHashMap<>(), null));
    }

    @Transactional(readOnly = true)
    public List<DailyReportResponse> range(AppUserDetails caller, Long officerId, LocalDate from, LocalDate to) {
        Long who = officerId == null ? caller.getId() : officerId;
        scopeService.assertVisible(caller, who);
        LocalDate end = to == null ? today() : to;
        LocalDate start = from == null ? end.minusDays(6) : from;
        if (start.isAfter(end) || start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("BAD_RANGE", "Choose a range of at most " + MAX_RANGE_DAYS + " days.");
        }
        return repository.findByOfficerIdAndReportDateBetweenOrderByReportDateAsc(who, start, end)
                .stream().map(this::toResponse).toList();
    }

    /** Saves the caller's own report for one day (the whole report - last save wins). */
    @Transactional
    public DailyReportResponse save(AppUserDetails caller, LocalDate date, DailyReportRequest req) {
        if (caller.getRole() != Role.SO) {
            throw ApiException.forbidden("NOT_A_SALES_OFFICER", "Only a Sales Officer fills a Daily Shop Report.");
        }
        if (date == null) {
            throw ApiException.badRequest("DATE_REQUIRED", "Choose the date of the report.");
        }
        if (date.isAfter(today())) {
            throw ApiException.badRequest("FUTURE_DATE", "A report cannot be saved for a future date.");
        }
        String header = write(req.header());
        String rows = write(req.rows());
        if (header.length() + rows.length() > MAX_JSON_CHARS) {
            throw ApiException.badRequest("REPORT_TOO_LARGE", "The report is too large - remove a photo and try again.");
        }
        User officer = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        DailyReport r = repository.findByOfficerIdAndReportDate(officer.getId(), date)
                .orElseGet(() -> DailyReport.builder().officer(officer).reportDate(date).build());
        r.setHeaderJson(header);
        r.setRowsJson(rows);
        return toResponse(repository.save(r));
    }

    private DailyReportResponse toResponse(DailyReport r) {
        return new DailyReportResponse(r.getOfficer().getId(), r.getReportDate(), read(r.getHeaderJson()), read(r.getRowsJson()),
                r.getUpdatedAt());
    }

    private String write(Map<String, Object> m) {
        try {
            return objectMapper.writeValueAsString(m == null ? Map.of() : m);
        } catch (JsonProcessingException e) {
            throw ApiException.badRequest("BAD_REPORT", "The report could not be read.");
        }
    }

    private Map<String, Object> read(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            return objectMapper.readValue(json, MAP);
        } catch (JsonProcessingException e) {
            return new LinkedHashMap<>();
        }
    }

    private static LocalDate today() {
        return TimeUtil.nowIst().toLocalDate();
    }
}
