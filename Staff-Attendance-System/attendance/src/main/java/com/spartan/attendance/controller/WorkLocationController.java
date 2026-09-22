package com.spartan.attendance.controller;

import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.dto.WorkLocationRequest;
import com.spartan.attendance.dto.WorkLocationResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.WorkLocationService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/work-locations")
@RequiredArgsConstructor
@Tag(name = "Work locations (geofence)", description = "Permitted attendance locations. Anyone signed in can read active ones; only ADMIN changes them.")
public class WorkLocationController {

    private final WorkLocationService service;

    @Operation(summary = "List work locations. Active only, unless an ADMIN passes includeInactive=true.")
    @GetMapping
    public List<WorkLocationResponse> list(@AuthenticationPrincipal AppUserDetails caller,
                                           @RequestParam(defaultValue = "false") boolean includeInactive) {
        boolean admin = caller.getRole() == com.spartan.attendance.entity.Role.ADMIN;
        return service.list(admin && includeInactive);
    }

    @Operation(summary = "Get one work location")
    @GetMapping("/{id}")
    public WorkLocationResponse get(@PathVariable Long id) {
        return service.get(id);
    }

    @Operation(summary = "Create a work location (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorkLocationResponse create(@AuthenticationPrincipal AppUserDetails caller,
                                       @Valid @RequestBody WorkLocationRequest request, HttpServletRequest http) {
        return service.create(caller, request, RequestInfo.from(http));
    }

    @Operation(summary = "Edit a work location (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PutMapping("/{id}")
    public WorkLocationResponse update(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                       @Valid @RequestBody WorkLocationRequest request, HttpServletRequest http) {
        return service.update(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Activate / deactivate a work location (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PatchMapping("/{id}/status")
    public WorkLocationResponse setStatus(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                          @Valid @RequestBody StatusRequest request, HttpServletRequest http) {
        return service.setStatus(caller, id, request, RequestInfo.from(http));
    }
}
