package com.spartan.attendance.controller;

import com.spartan.attendance.dto.ShopRequest;
import com.spartan.attendance.dto.ShopResponse;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Shops the Area Sales Manager (or RM / Marketing Manager) adds for the Sales Officers in their own team. These are the
 * ONLY shops a Sales Officer sees - in My Area & Shops, the Daily Shop Report and shop check-in (GET /api/shops/mine).
 */
@RestController
@RequestMapping("/api/team/shops")
@RequiredArgsConstructor
@PreAuthorize("hasAnyRole('ADMIN','OWNER','RSM','RM','ASM')")
@Tag(name = "Team shops", description = "Managers add / edit / remove the shops assigned to Sales Officers in their own team.")
public class TeamShopController {

    private final ShopService service;

    @Operation(summary = "Shops of my team (optionally one officer's)")
    @GetMapping
    public List<ShopResponse> list(@AuthenticationPrincipal AppUserDetails caller,
                                   @RequestParam(required = false) Long officerId) {
        return service.teamList(caller, officerId);
    }

    @Operation(summary = "Add a shop and assign it to one of my Sales Officers")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ShopResponse create(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody ShopRequest request,
                               HttpServletRequest http) {
        return service.teamCreate(caller, request, RequestInfo.from(http));
    }

    @Operation(summary = "Edit / reassign one of my team's shops")
    @PutMapping("/{id}")
    public ShopResponse update(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                               @Valid @RequestBody ShopRequest request, HttpServletRequest http) {
        return service.teamUpdate(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Remove one of my team's shops")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                       HttpServletRequest http) {
        service.teamDelete(caller, id, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }
}
