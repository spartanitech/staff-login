package com.spartan.attendance.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * One day of the Weekly Stock Report for the signed-in Sales Officer. Opening is only used for a product that has no
 * earlier day on record (the very first entry); after that the server always carries yesterday's closing forward.
 */
public record StockDayRequest(
        @Size(max = 150) String dpName,
        @NotNull(message = "rows are required") @Size(max = 200) List<@Valid Row> rows) {

    public record Row(
            @NotBlank(message = "product is required") @Size(max = 150) String product,
            @Size(max = 60) String category,
            @Min(value = 0, message = "Opening cannot be negative") Integer opening,
            @Min(value = 0, message = "Receipt cannot be negative") Integer receipt,
            @Min(value = 0, message = "SO Sales cannot be negative") Integer soSales,
            @Min(value = 0, message = "DP Sales cannot be negative") Integer dpSales,
            @Min(value = 0, message = "Price cannot be negative") Double unitPrice) {
    }
}
