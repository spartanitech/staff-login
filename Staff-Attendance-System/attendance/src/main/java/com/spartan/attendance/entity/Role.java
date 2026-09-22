package com.spartan.attendance.entity;

/**
 * The ONE internal spelling of every role. The UI label for ADMIN is "Admin"; the legacy frontend key
 * "sup" (from when this role was called Supervisor) is translated to/from this enum only in api.js.
 */
public enum Role {
    ADMIN("ADM"), OWNER("OWN"), RSM("RSM"), RM("RM"), ASM("ASM"), SO("SO");

    private final String codePrefix;

    Role(String codePrefix) {
        this.codePrefix = codePrefix;
    }

    public String codePrefix() {
        return codePrefix;
    }

    /** ADMIN and OWNER see every employee; everyone else only their own reporting tree. */
    public boolean hasGlobalScope() {
        return this == ADMIN || this == OWNER;
    }

    /** Roles that may look at other people's attendance (still limited by scope). */
    public boolean isManager() {
        return this == RSM || this == RM || this == ASM;
    }
}
