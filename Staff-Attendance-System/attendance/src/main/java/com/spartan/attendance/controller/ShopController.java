package com.spartan.attendance.controller;

import com.spartan.attendance.dto.ShopRequest;
import com.spartan.attendance.dto.ShopResponse;
import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.ShopService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
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
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Shops", description = "Shops Sales Officers mark attendance at. Managed by the Admin; a Sales Officer only sees the shops assigned to them.")
public class ShopController {

    private final ShopService service;

    @Operation(summary = "The active shops assigned to me (Sales Officer)")
    @PreAuthorize("hasRole('SO')")
    @GetMapping("/shops/mine")
    public List<ShopResponse> mine(@AuthenticationPrincipal AppUserDetails caller) {
        return service.mine(caller);
    }

    @Operation(summary = "All shops, optionally only one officer's (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin/shops")
    public List<ShopResponse> list(@RequestParam(defaultValue = "true") boolean includeInactive,
                                   @RequestParam(required = false) Long officerId) {
        return service.list(includeInactive, officerId);
    }

    @Operation(summary = "Create a shop (ADMIN). A blank code is generated; a missing radius uses the default.")
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping("/admin/shops")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopResponse create(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody ShopRequest request,
                               HttpServletRequest http) {
        return service.create(caller, request, RequestInfo.from(http));
    }

    @Operation(summary = "Edit a shop, move its pin or reassign it (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PutMapping("/admin/shops/{id}")
    public ShopResponse update(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                               @Valid @RequestBody ShopRequest request, HttpServletRequest http) {
        return service.update(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Activate / deactivate a shop (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PatchMapping("/admin/shops/{id}/status")
    public ShopResponse setStatus(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                  @Valid @RequestBody StatusRequest request, HttpServletRequest http) {
        return service.setStatus(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Permanently delete a shop (ADMIN). Past attendance recorded there is kept, just unlinked from the shop.")
    @PreAuthorize("hasRole('ADMIN')")
    @DeleteMapping("/admin/shops/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                       HttpServletRequest http) {
        service.delete(caller, id, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }
}
