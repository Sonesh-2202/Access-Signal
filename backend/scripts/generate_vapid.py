"""Generate the VAPID key pair for Web Push. Run once per deployment and store the output as
environment variables (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). Keep the private key secret.

    python -m scripts.generate_vapid
"""

import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01


def main() -> int:
    v = Vapid01()
    v.generate_keys()
    public = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    public_b64 = base64.urlsafe_b64encode(public).rstrip(b"=").decode("ascii")
    private_pem = v.private_pem().decode("ascii").strip()
    print("VAPID_PUBLIC_KEY=" + public_b64)
    print("VAPID_PRIVATE_KEY=" + private_pem.replace("\n", "\\n"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())