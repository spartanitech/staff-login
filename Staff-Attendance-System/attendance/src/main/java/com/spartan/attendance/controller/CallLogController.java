package com.spartan.attendance.controller;

import com.spartan.attendance.dto.CallLogRequest;
import com.spartan.attendance.dto.CallLogResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.CallLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/call-logs")
@RequiredArgsConstructor
@Tag(name = "Telephone Call Report", description = "Shop calls made by Sales Officers.")
public class CallLogController {

    private final CallLogService service;

    @Operation(summary = "Calls I may see (SO: mine; managers: my team). Default: last 30 days.")
    @GetMapping
    public List<CallLogResponse> list(@AuthenticationPrincipal AppUserDetails caller,
                                      @RequestParam(required = false) Long officerId,
                                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.list(caller, officerId, from, to);
    }

    @Operation(summary = "Log a shop call (Sales Officer)")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CallLogResponse log(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody CallLogRequest request) {
        return service.log(caller, request);
    }

    @Operation(summary = "Correct the shop name of a logged call (own, or Admin). Body: {\"shop\": \"...\"}")
    @PutMapping("/{id}")
    public CallLogResponse rename(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                  @RequestBody java.util.Map<String, String> body) {
        return service.rename(caller, id, body == null ? null : body.get("shop"));
    }

    @Operation(summary = "Remove a logged call (own, or Admin)")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        service.delete(caller, id);
        return ResponseEntity.noContent().build();
    }
}
