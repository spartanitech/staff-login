package com.spartan.attendance.controller;

import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.PromotionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/promotions")
@RequiredArgsConstructor
@Tag(name = "Promotions", description = "Offers, coupons, festival and combo offers.")
public class PromotionController {

    private final PromotionService service;

    @Operation(summary = "All promotions: {initialized, items}")
    @GetMapping
    public Map<String, Object> list() {
        return service.list();
    }

    @Operation(summary = "Add a promotion (Admin, Owner, Marketing Manager)")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@AuthenticationPrincipal AppUserDetails caller, @RequestBody Map<String, Object> body) {
        return service.create(caller, body);
    }

    @Operation(summary = "First run only: store the starting list once")
    @PostMapping("/import")
    public Map<String, Object> importInitial(@AuthenticationPrincipal AppUserDetails caller, @RequestBody List<Map<String, Object>> items) {
        return service.importInitial(caller, items);
    }

    @Operation(summary = "Delete a promotion (Admin, Owner, Marketing Manager)")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        service.delete(caller, id);
        return ResponseEntity.noContent().build();
    }
}
