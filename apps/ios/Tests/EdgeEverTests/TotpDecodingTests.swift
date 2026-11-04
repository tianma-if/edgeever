import XCTest
@testable import EdgeEver

final class TotpDecodingTests: XCTestCase {
    // MARK: - Error envelopes

    func testMfaRequiredErrorDecodesChallengeDetails() {
        let body = Data("""
        {"error":{"code":"mfa_required","message":"Two-factor authentication required","details":{"challengeToken":"chal_abc","expiresAt":"2026-11-02T10:05:00.000Z","methods":["totp","recovery_code"]}}}
        """.utf8)
        let error = APIClient.decodeAPIError(status: 401, data: body)
        XCTAssertEqual(error.status, 401)
        XCTAssertEqual(error.code, "mfa_required")
        XCTAssertEqual(error.message, "Two-factor authentication required")
        XCTAssertEqual(error.mfaChallenge, MfaChallenge(
            challengeToken: "chal_abc",
            expiresAt: "2026-11-02T10:05:00.000Z",
            methods: ["totp", "recovery_code"]
        ))
        XCTAssertFalse(error.isMfaRebindRequired)
    }

    func testMfaRequiredWithoutDetailsHasNoChallenge() {
        let body = Data(#"{"error":{"code":"mfa_required","message":"x"}}"#.utf8)
        XCTAssertNil(APIClient.decodeAPIError(status: 401, data: body).mfaChallenge)
    }

    func testOtherErrorsIgnoreDetails() {
        let body = Data("""
        {"error":{"code":"invalid_totp_code","message":"Invalid code","details":{"challengeToken":"nope","expiresAt":"x","methods":[]}}}
        """.utf8)
        let error = APIClient.decodeAPIError(status: 401, data: body)
        XCTAssertEqual(error.code, "invalid_totp_code")
        XCTAssertNil(error.mfaChallenge)
    }

    func testRateLimitParsesRetryAfter() {
        let body = Data(#"{"error":{"code":"login_rate_limited","message":"Too many attempts"}}"#.utf8)
        let error = APIClient.decodeAPIError(status: 429, data: body, retryAfter: " 120 ")
        XCTAssertEqual(error.retryAfterSeconds, 120)
        XCTAssertNil(APIClient.decodeAPIError(status: 429, data: body, retryAfter: "soon").retryAfterSeconds)
    }

    func testRebindRequiredErrorIsDetected() {
        let body = Data(#"{"error":{"code":"mfa_rebind_required","message":"Rebind required"}}"#.utf8)
        XCTAssertTrue(APIClient.decodeAPIError(status: 403, data: body).isMfaRebindRequired)
        XCTAssertFalse(APIClient.decodeAPIError(status: 401, data: body).isMfaRebindRequired)
    }

    func testNonJSONErrorFallsBackToStatusText() {
        let error = APIClient.decodeAPIError(status: 503, data: Data("oops".utf8))
        XCTAssertNil(error.code)
        XCTAssertFalse(error.message.isEmpty)
    }

    // MARK: - Sessions

    func testAuthSessionDecodesRestrictedFlag() throws {
        let restricted = try EdgeEverJSON.decoder.decode(AuthSession.self, from: Data("""
        {"authRequired":true,"authenticated":true,"demoMode":false,"sessionToken":"tok","user":{"id":"u1","username":"admin","displayName":null,"role":"owner"},"mfaRebindRequired":true}
        """.utf8))
        XCTAssertEqual(restricted.mfaRebindRequired, true)
        XCTAssertEqual(restricted.sessionToken, "tok")

        let normal = try EdgeEverJSON.decoder.decode(AuthSession.self, from: Data("""
        {"authRequired":true,"authenticated":true,"demoMode":false,"sessionToken":"tok","user":null}
        """.utf8))
        XCTAssertNil(normal.mfaRebindRequired)
    }

    func testLegacyStoredMobileSessionStillDecodes() throws {
        let stored = try EdgeEverJSON.decoder.decode(MobileSession.self, from: Data("""
        {"baseUrl":"https://demo.edgeever.org","token":"tok","user":null}
        """.utf8))
        XCTAssertNil(stored.mfaRebindRequired)

        var restricted = stored
        restricted.mfaRebindRequired = true
        let roundTrip = try EdgeEverJSON.decoder.decode(
            MobileSession.self,
            from: EdgeEverJSON.encoder.encode(restricted)
        )
        XCTAssertEqual(roundTrip.mfaRebindRequired, true)
    }

    // MARK: - TOTP responses

    func testTotpStatusDecodes() throws {
        let status = try EdgeEverJSON.decoder.decode(TotpStatus.self, from: Data("""
        {"enabled":true,"enabledAt":"2026-11-01T08:00:00.000Z","recoveryCodesRemaining":7,"available":true,"unavailableReason":null,"rebindRequired":false}
        """.utf8))
        XCTAssertTrue(status.enabled)
        XCTAssertEqual(status.recoveryCodesRemaining, 7)
        XCTAssertNil(status.unavailableReason)

        let off = try EdgeEverJSON.decoder.decode(TotpStatus.self, from: Data("""
        {"enabled":false,"enabledAt":null,"recoveryCodesRemaining":0,"available":false,"unavailableReason":"encryption_unavailable","rebindRequired":false}
        """.utf8))
        XCTAssertFalse(off.available)
        XCTAssertNil(off.enabledAt)
        XCTAssertEqual(off.unavailableReason, "encryption_unavailable")
    }

    func testSetupRecoveryCodesAndConfirmResponsesDecode() throws {
        let setup = try EdgeEverJSON.decoder.decode(TotpSetupResponse.self, from: Data("""
        {"setupId":"setup_abc","secret":"JBSWY3DPEHPK3PXP","otpauthUri":"otpauth://totp/EdgeEver:admin?secret=JBSWY3DPEHPK3PXP&issuer=EdgeEver","issuer":"EdgeEver","accountName":"admin","expiresAt":"2026-11-02T10:15:00.000Z"}
        """.utf8))
        XCTAssertEqual(setup.setupId, "setup_abc")
        XCTAssertEqual(setup.issuer, "EdgeEver")
        XCTAssertTrue(setup.otpauthUri.hasPrefix("otpauth://"))

        let codes = try EdgeEverJSON.decoder.decode(TotpRecoveryCodesResponse.self, from: Data("""
        {"batchId":"rcb_abc","recoveryCodes":["AAAA-BBBB-CCCC","DDDD-EEEE-FFFF"]}
        """.utf8))
        XCTAssertEqual(codes.batchId, "rcb_abc")
        XCTAssertEqual(codes.recoveryCodes.count, 2)
        // The ids are part of the contract: a response without them is not something confirm can act on.
        XCTAssertThrowsError(try EdgeEverJSON.decoder.decode(TotpRecoveryCodesResponse.self, from: Data(#"{"recoveryCodes":[]}"#.utf8)))

        let rotated = try EdgeEverJSON.decoder.decode(TotpConfirmResponse.self, from: Data(#"{"ok":true,"sessionToken":"new_tok"}"#.utf8))
        XCTAssertEqual(rotated.sessionToken, "new_tok")
        let plain = try EdgeEverJSON.decoder.decode(TotpConfirmResponse.self, from: Data(#"{"ok":true}"#.utf8))
        XCTAssertNil(plain.sessionToken)
    }

    // MARK: - Request bodies

    func testReauthInputOmitsMissingFields() throws {
        XCTAssertEqual(String(decoding: try EdgeEverJSON.encoder.encode(TotpReauthInput()), as: UTF8.self), "{}")
        XCTAssertEqual(
            String(decoding: try EdgeEverJSON.encoder.encode(TotpReauthInput(password: "pw", code: "123456")), as: UTF8.self),
            #"{"code":"123456","password":"pw"}"#
        )
    }

    func testLoginMfaInputEncodesExactlyOneFactor() throws {
        let json = String(decoding: try EdgeEverJSON.encoder.encode(LoginMfaInput(
            challengeToken: "chal",
            code: nil,
            recoveryCode: "AAAA-BBBB-CCCC",
            deviceId: "dev1"
        )), as: UTF8.self)
        XCTAssertEqual(json, #"{"challengeToken":"chal","deviceId":"dev1","recoveryCode":"AAAA-BBBB-CCCC"}"#)
    }

    func testIdentityInputBuildsReauth() {
        var input = TotpIdentityInput(password: "pw")
        XCTAssertTrue(input.isComplete(requiresSecondFactor: false))
        XCTAssertFalse(input.isComplete(requiresSecondFactor: true))
        input.code = "123456"
        XCTAssertEqual(input.reauth(requiresSecondFactor: true), TotpReauthInput(password: "pw", code: "123456"))
        input.useRecoveryCode = true
        input.recoveryCode = " aaaa-bbbb-cccc "
        XCTAssertEqual(
            input.reauth(requiresSecondFactor: true),
            TotpReauthInput(password: "pw", recoveryCode: "aaaa-bbbb-cccc")
        )
        XCTAssertEqual(input.reauth(requiresSecondFactor: false), TotpReauthInput(password: "pw"))
    }

    // MARK: - Formatting

    func testCodeSanitizerAndSecretGrouping() {
        XCTAssertEqual(TotpFormat.sanitizeCode("12 34-5678"), "123456")
        XCTAssertEqual(TotpFormat.sanitizeCode("abc"), "")
        XCTAssertEqual(TotpFormat.groupedSecret("jbswy3dpehpk3pxp"), "JBSW Y3DP EHPK 3PXP")
        XCTAssertEqual(TotpFormat.groupedSecret("ABCDEF"), "ABCD EF")
    }

    func testQRCodeImageIsGenerated() {
        XCTAssertNotNil(TotpQRCodeView.makeImage("otpauth://totp/EdgeEver:admin?secret=JBSWY3DPEHPK3PXP&issuer=EdgeEver"))
    }

    // MARK: - Unauthorized handling

    func testLoginMfaRequiredDoesNotTriggerSessionLoss() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TotpStubProtocol.self]
        let flag = UnauthorizedFlag()
        let client = APIClient(
            baseURL: URL(string: "https://totp.test")!,
            session: URLSession(configuration: configuration),
            onUnauthorized: { flag.set() }
        )
        do {
            _ = try await client.login(LoginInput(username: "admin", password: "pw", deviceId: "dev1"))
            XCTFail("expected mfa_required")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "mfa_required")
            XCTAssertEqual(error.mfaChallenge?.challengeToken, "chal_stub")
        }
        do {
            _ = try await client.completeMfaLogin(LoginMfaInput(challengeToken: "chal_stub", code: "000000", recoveryCode: nil, deviceId: "dev1"))
            XCTFail("expected invalid_totp_code")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "invalid_totp_code")
        }
        XCTAssertFalse(flag.value, "401 from login endpoints must not clear the local session")

        // Business endpoints still report session loss.
        _ = try? await client.getSession()
        XCTAssertTrue(flag.value)
    }
}

private final class UnauthorizedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var raw = false
    var value: Bool { lock.withLock { raw } }
    func set() { lock.withLock { raw = true } }
}

private final class TotpStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let body: String
        switch url.path {
        case "/api/v1/auth/login":
            body = #"{"error":{"code":"mfa_required","message":"MFA","details":{"challengeToken":"chal_stub","expiresAt":"2026-11-02T10:05:00.000Z","methods":["totp","recovery_code"]}}}"#
        case "/api/v1/auth/login/mfa":
            body = #"{"error":{"code":"invalid_totp_code","message":"Invalid code"}}"#
        default:
            body = #"{"error":{"code":"unauthorized","message":"Unauthorized"}}"#
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: 401,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
