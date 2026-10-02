package com.spartan.attendance.controller;

import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.OrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
@Tag(name = "Orders", description = "Orders booked by Sales Officers; their managers and the Admin read them. Booking never marks attendance.")
public class OrderController {

    private final OrderService service;

    @Operation(summary = "Orders between two dates (default: last 30 days) - mine, my team's, or everyone's for Admin/Owner")
    @GetMapping
    public List<OrderService.OrderResponse> list(@AuthenticationPrincipal AppUserDetails caller,
                                                 @RequestParam(required = false) Long officerId,
                                                 @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                 @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.list(caller, officerId, from, to);
    }

    @Operation(summary = "Save one of my orders (Sales Officer). Sending the same clientRef again updates that order.")
    @PutMapping
    public OrderService.OrderResponse save(@AuthenticationPrincipal AppUserDetails caller,
                                           @RequestBody OrderService.OrderRequest request) {
        return service.save(caller, request);
    }
}
