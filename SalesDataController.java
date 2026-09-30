package com.spartan.attendance.controller;

import com.spartan.attendance.dto.DpNameRequest;
import com.spartan.attendance.dto.DpNameResponse;
import com.spartan.attendance.dto.StockDayRequest;
import com.spartan.attendance.dto.StockEntryResponse;
import com.spartan.attendance.dto.TargetRequest;
import com.spartan.attendance.dto.TargetResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.DpNameService;
import com.spartan.attendance.service.StockService;
import com.spartan.attendance.service.TargetService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Sales Officer reporting data that must be the same on every device: DP names, daily stock and monthly targets. */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Sales data", description = "DP names, daily stock (opening/receipt/SO sales/DP sales/closing) and monthly targets.")
public class SalesDataController {

    private final DpNameService dpNameService;
    private final StockService stockService;
    private final TargetService targetService;

    // ---------------------------------------------------------------- DP names
    @Operation(summary = "All DP (distributor) names")
    @GetMapping("/dp-names")
    public List<DpNameResponse> dpNames() {
        return dpNameService.list();
    }

    @Operation(summary = "Add a DP name (returns the existing one if it is already there)")
    @PostMapping("/dp-names")
    public DpNameResponse addDpName(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody DpNameRequest request) {
        return dpNameService.add(caller, request.name());
    }

    // ---------------------------------------------------------------- stock
    @Operation(summary = "Stock entries between two dates (default: the last 7 days). Managers may pass officerId from their team.")
    @GetMapping("/stock")
    public List<StockEntryResponse> stock(@AuthenticationPrincipal AppUserDetails caller,
                                          @RequestParam(required = false) Long officerId,
                                          @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                          @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return stockService.list(caller, officerId, from, to);
    }

    @Operation(summary = "Opening stock per product for a day (= the previous day's closing)")
    @GetMapping("/stock/openings")
    public Map<String, Integer> openings(@AuthenticationPrincipal AppUserDetails caller,
                                         @RequestParam(required = false) Long officerId,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return stockService.openings(caller, officerId, date);
    }

    @Operation(summary = "Save my stock for one day; closing and next-day opening are calculated by the server")
    @PutMapping("/stock/{date}")
    public List<StockEntryResponse> saveStock(@AuthenticationPrincipal AppUserDetails caller,
                                              @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                              @Valid @RequestBody StockDayRequest request) {
        return stockService.saveDay(caller, date, request);
    }

    // ---------------------------------------------------------------- targets
    @Operation(summary = "A monthly target (default: mine, this month)")
    @GetMapping("/targets")
    public TargetResponse target(@AuthenticationPrincipal AppUserDetails caller,
                                 @RequestParam(required = false) Long officerId,
                                 @RequestParam(required = false) String month) {
        return targetService.get(caller, officerId, month);
    }

    @Operation(summary = "Targets of everyone in my team for a month")
    @GetMapping("/targets/team")
    public List<TargetResponse> teamTargets(@AuthenticationPrincipal AppUserDetails caller,
                                            @RequestParam(required = false) String month) {
        return targetService.team(caller, month);
    }

    @Operation(summary = "Set a monthly target for someone in my team (ASM / RM / Marketing Manager / Admin)")
    @PutMapping("/targets")
    public TargetResponse setTarget(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody TargetRequest request) {
        return targetService.set(caller, request);
    }
}
