import XCTest
@testable import EdgeEver

final class URLNormalizeTests: XCTestCase {
    func testAddsHTTPS() throws {
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL("demo.edgeever.org")
        XCTAssertEqual(url.absoluteString, "https://demo.edgeever.org")
    }

    func testStripsTrailingSlash() throws {
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL("https://demo.edgeever.org/")
        XCTAssertEqual(url.absoluteString, "https://demo.edgeever.org")
    }

    func testRejectsEmpty() {
        XCTAssertThrowsError(try EdgeEverURLNormalizer.normalizeInstanceURL("  "))
    }

    func testMapsBareDemoAliasToPublicInstance() throws {
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("demo").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("https://demo").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("DEMO/").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
    }
}
