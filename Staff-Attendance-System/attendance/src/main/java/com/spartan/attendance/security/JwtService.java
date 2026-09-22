package com.spartan.attendance.security;

import com.spartan.attendance.config.AppProperties;
import com.spartan.attendance.entity.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Date;
import javax.crypto.SecretKey;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class JwtService {

    private final SecretKey key;
    private final long expirationMinutes;
    private final String issuer;

    public JwtService(AppProperties props) {
        String secret = props.getJwt().getSecret();
        if (secret == null || secret.isBlank()) {
            // Local development only (prod requires JWT_SECRET): keep one generated key in the user's home folder so
            // restarting the backend does not invalidate every signed-in browser.
            secret = loadOrCreateDevSecret();
            if (secret == null) {
                byte[] random = new byte[48];
                new SecureRandom().nextBytes(random);
                secret = java.util.Base64.getEncoder().encodeToString(random);
                log.warn("JWT_SECRET is not set and no key file could be written - using a random key for this run only. "
                        + "Everyone is signed out when the backend restarts.");
            } else {
                log.warn("JWT_SECRET is not set - using the local development key stored in ~/.staff-attendance/. "
                        + "Set JWT_SECRET (32+ characters) for any real deployment.");
            }
        } else if (secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes long");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMinutes = props.getJwt().getExpirationMinutes();
        this.issuer = props.getJwt().getIssuer();
    }

    private static String loadOrCreateDevSecret() {
        Path file = Path.of(System.getProperty("user.home"), ".staff-attendance", "jwt-dev-secret.txt");
        try {
            if (Files.exists(file)) {
                String existing = Files.readString(file, StandardCharsets.UTF_8).trim();
                if (existing.getBytes(StandardCharsets.UTF_8).length >= 32) {
                    return existing;
                }
            }
            byte[] random = new byte[48];
            new SecureRandom().nextBytes(random);
            String created = java.util.Base64.getEncoder().encodeToString(random);
            Files.createDirectories(file.getParent());
            Files.writeString(file, created, StandardCharsets.UTF_8);
            return created;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    public long expiresInSeconds() {
        return expirationMinutes * 60;
    }

    /**
     * The token identifies the user (subject = user id). The role claim is informational for clients only:
     * the server always re-reads the role and status from the database on every request.
     */
    public String generate(User user) {
        Date now = new Date();
        return Jwts.builder()
                .issuer(issuer)
                .subject(String.valueOf(user.getId()))
                .claim("role", user.getRole().name())
                .claim("username", user.getUsername())
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expirationMinutes * 60_000L))
                .signWith(key)
                .compact();
    }

    /** @throws JwtException if the token is malformed, tampered with, or expired (ExpiredJwtException is a subtype). */
    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).requireIssuer(issuer).build().parseSignedClaims(token).getPayload();
    }
}
