package com.spartan.attendance.util;

import jakarta.servlet.http.HttpServletRequest;

/** Who/where a request came from, captured once in the controller and passed to services for auditing. */
public record RequestInfo(String ipAddress, String userAgent) {

    public static RequestInfo from(HttpServletRequest request) {
        String ua = request.getHeader("User-Agent");
        if (ua != null && ua.length() > 255) {
            ua = ua.substring(0, 255);
        }
        // getRemoteAddr() already reflects X-Forwarded-For when (and only when) the prod profile
        // has Tomcat's RemoteIpValve trusting the reverse proxy - a client cannot spoof it directly.
        return new RequestInfo(request.getRemoteAddr(), ua);
    }
}
