package com.spartan.attendance.service;

import com.spartan.attendance.config.AppProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Stores the live shop photo taken at check-in as a file in a folder OUTSIDE the web root, under a random name.
 * The database keeps only that name; the photo is only reachable through the authenticated, scope-checked
 * GET /api/attendance/{id}/photo endpoint.
 */
@Slf4j
@Component
public class PhotoStorage {

    private final Path root;

    public PhotoStorage(AppProperties props) {
        this.root = Paths.get(props.getAttendance().getPhotoDir()).toAbsolutePath().normalize();
    }

    /** What the file really is, judged by its first bytes (the browser-supplied content type is never trusted). Null = not an accepted image. */
    public static String detectExtension(byte[] b) {
        if (b == null || b.length < 12) {
            return null;
        }
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "jpg";
        }
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return "png";
        }
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "webp";
        }
        return null;
    }

    public static String contentTypeFor(String fileName) {
        String n = fileName == null ? "" : fileName.toLowerCase();
        if (n.endsWith(".png")) {
            return "image/png";
        }
        if (n.endsWith(".webp")) {
            return "image/webp";
        }
        return "image/jpeg";
    }

    /** @return the generated file name (uuid + extension) to keep in the database */
    public String save(byte[] bytes, String extension) throws IOException {
        Files.createDirectories(root);
        String name = UUID.randomUUID() + "." + extension;
        Files.write(root.resolve(name), bytes, StandardOpenOption.CREATE_NEW);
        return name;
    }

    /** @return the photo bytes, or null when the file no longer exists on disk */
    public byte[] read(String fileName) throws IOException {
        Path p = root.resolve(fileName).normalize();
        if (!p.startsWith(root)) {
            throw new IOException("Invalid photo path");
        }
        try {
            return Files.readAllBytes(p);
        } catch (NoSuchFileException e) {
            return null;
        }
    }

    public void deleteQuietly(String fileName) {
        if (fileName == null) {
            return;
        }
        try {
            Path p = root.resolve(fileName).normalize();
            if (p.startsWith(root)) {
                Files.deleteIfExists(p);
            }
        } catch (IOException e) {
            log.warn("Could not delete photo {}: {}", fileName, e.getMessage());
        }
    }
}
