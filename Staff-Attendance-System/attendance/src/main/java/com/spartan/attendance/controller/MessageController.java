package com.spartan.attendance.controller;

import com.spartan.attendance.dto.MessageRequest;
import com.spartan.attendance.dto.MessageResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.MessageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/messages")
@RequiredArgsConstructor
@Tag(name = "Messages", description = "The portal message board (everyone / a role / one named person).")
public class MessageController {

    private final MessageService service;

    @Operation(summary = "Messages I may see (newest first, last 180 days, at most 500)")
    @GetMapping
    public List<MessageResponse> list(@AuthenticationPrincipal AppUserDetails caller) {
        return service.list(caller);
    }

    @Operation(summary = "Send a message")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MessageResponse send(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody MessageRequest request) {
        return service.send(caller, request);
    }

    @Operation(summary = "Edit the text of a message I sent")
    @PutMapping("/{id}")
    public MessageResponse edit(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                @RequestBody Map<String, String> body) {
        return service.edit(caller, id, body == null ? null : body.get("text"));
    }

    @Operation(summary = "Delete a message I sent (Admin: any message)")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        service.delete(caller, id);
        return ResponseEntity.noContent().build();
    }
}
