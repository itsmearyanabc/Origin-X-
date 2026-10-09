import type { OrgRole, PlatformRole } from "../lib/constants.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        fullName: string;
        platformRole: PlatformRole | string;
      };
      membership?: {
        id: string;
        organizationId: string;
        role: OrgRole;
      };
      organization?: {
        id: string;
        name: string;
        status: string;
        verificationStatus: string;
      };
    }
  }
}

export {};
