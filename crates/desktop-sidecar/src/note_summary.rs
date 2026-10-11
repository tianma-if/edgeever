//! List-row metadata for diagram, infographic, and table notes.
//! This follows `getDiagramSummary`, `getInfographicSummary`, and `getTableSummary`
//! so desktop cards match the web list without returning the document payload.

use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

struct DiagramPreview {
    kind: &'static str,
    node_count: usize,
    edge_count: usize,
    labels: Vec<String>,
}

struct TablePreview {
    field_count: usize,
    record_count: usize,
    field_names: Vec<String>,
}

struct SummaryNode {
    id: String,
    label: String,
    shape: String,
    parent_id: Option<String>,
}

struct SummaryEdge {
    source: String,
    target: String,
}

pub(crate) fn note_list_metadata(markdown: &str) -> Value {
    let mut metadata = Map::new();
    match diagram_preview(markdown) {
        Some(preview) => {
            metadata.insert("diagramKind".to_owned(), json!(preview.kind));
            metadata.insert(
                "diagramPreview".to_owned(),
                json!({
                    "nodeCount": preview.node_count,
                    "edgeCount": preview.edge_count,
                    "labels": preview.labels,
                }),
            );
        }
        None => {
            metadata.insert("diagramKind".to_owned(), Value::Null);
        }
    }
    metadata.insert("infographic".to_owned(), json!(is_infographic(markdown)));
    metadata.insert(
        "poster".to_owned(),
        json!(markdown.contains("<!-- edgeever-poster-v1:")),
    );
    match table_preview(markdown) {
        Some(preview) => {
            metadata.insert("structuredTable".to_owned(), json!(true));
            metadata.insert(
                "tablePreview".to_owned(),
                json!({
                    "fieldCount": preview.field_count,
                    "recordCount": preview.record_count,
                    "fieldNames": preview.field_names,
                }),
            );
        }
        None => {
            metadata.insert("structuredTable".to_owned(), json!(false));
        }
    }
    Value::Object(metadata)
}

fn is_infographic(markdown: &str) -> bool {
    let Some(payload) = infographic_payload(markdown) else {
        return false;
    };
    if payload.len() > 2_000_000 {
        return false;
    }
    let Some(value) = decode_json(&payload) else {
        return false;
    };
    let Some(document) = value.as_object() else {
        return false;
    };
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return false;
    }
    let Some(syntax) = document.get("syntax").and_then(Value::as_str) else {
        return false;
    };
    js_len(syntax) <= 200_000 && valid_history(document)
}

fn valid_history(document: &Map<String, Value>) -> bool {
    let Some(history) = document.get("history") else {
        return true;
    };
    let Some(turns) = history.as_array() else {
        return false;
    };
    turns.iter().all(valid_turn)
}

fn valid_turn(value: &Value) -> bool {
    let Some(turn) = value.as_object() else {
        return false;
    };
    let Some(prompt) = turn.get("prompt").and_then(Value::as_str) else {
        return false;
    };
    if js_len(prompt) > 1000 {
        return false;
    }
    if !matches!(
        turn.get("kind").and_then(Value::as_str),
        Some("generated" | "refined" | "clarified" | "failed")
    ) {
        return false;
    }
    if turn.get("id").and_then(Value::as_str).is_none()
        || turn.get("createdAt").and_then(Value::as_str).is_none()
        || turn.get("resultTitle").and_then(Value::as_str).is_none()
    {
        return false;
    }
    optional_string(turn, "response", Some(4000))
        && optional_string(turn, "decision", Some(500))
        && optional_string(turn, "template", None)
        && optional_string(turn, "error", None)
        && optional_string(turn, "undoneAt", None)
}

fn optional_string(object: &Map<String, Value>, key: &str, max_units: Option<usize>) -> bool {
    match object.get(key) {
        None => true,
        Some(Value::String(value)) => max_units
            .map(|limit| js_len(value) <= limit)
            .unwrap_or(true),
        Some(_) => false,
    }
}

fn diagram_preview(markdown: &str) -> Option<DiagramPreview> {
    let value = decode_json(&marker_payload(markdown, "edgeever-diagram-v1")?)?;
    let document = value.as_object()?;
    let kind = document.get("kind")?.as_str()?;
    if !matches!(kind, "mind-map" | "flowchart" | "architecture") {
        return None;
    }
    let expected_version = if kind == "architecture" { 2 } else { 1 };
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(expected_version) {
        return None;
    }
    let raw_nodes = document.get("nodes")?.as_array()?;
    let raw_edges = document.get("edges")?.as_array()?;
    let nodes = raw_nodes
        .iter()
        .map(parse_node)
        .collect::<Option<Vec<_>>>()?;
    let edges = raw_edges
        .iter()
        .map(parse_edge)
        .collect::<Option<Vec<_>>>()?;
    let mut ids = HashSet::new();
    for node in &nodes {
        if !ids.insert(node.id.clone()) {
            return None;
        }
    }
    if nodes.iter().any(|node| {
        node.parent_id
            .as_ref()
            .is_some_and(|parent| parent == &node.id || !ids.contains(parent))
    }) {
        return None;
    }
    if edges
        .iter()
        .any(|edge| !ids.contains(&edge.source) || !ids.contains(&edge.target))
    {
        return None;
    }
    let shapes: HashMap<&str, &str> = nodes
        .iter()
        .map(|node| (node.id.as_str(), node.shape.as_str()))
        .collect();
    if kind == "architecture" {
        let prose_shape =
            |shape: &str| matches!(shape, "topic" | "process" | "decision" | "terminator");
        if nodes.iter().any(|node| prose_shape(&node.shape)) {
            return None;
        }
        if nodes.iter().any(|node| {
            node.parent_id
                .as_ref()
                .is_some_and(|parent| shapes.get(parent.as_str()).copied() != Some("boundary"))
        }) {
            return None;
        }
        if edges.iter().any(|edge| {
            shapes.get(edge.source.as_str()) == Some(&"boundary")
                || shapes.get(edge.target.as_str()) == Some(&"boundary")
        }) {
            return None;
        }
    } else if nodes.iter().any(|node| {
        !matches!(
            node.shape.as_str(),
            "topic" | "process" | "decision" | "terminator"
        )
    }) {
        return None;
    }
    let labels = preview_labels(kind, &nodes);
    Some(DiagramPreview {
        kind: match kind {
            "mind-map" => "mind-map",
            "architecture" => "architecture",
            _ => "flowchart",
        },
        node_count: nodes.len(),
        edge_count: edges.len(),
        labels,
    })
}

fn parse_node(value: &Value) -> Option<SummaryNode> {
    let node = value.as_object()?;
    let id = node.get("id")?.as_str()?;
    let label = node.get("label")?.as_str()?;
    let shape = node.get("shape")?.as_str()?;
    if id.is_empty()
        || !matches!(
            shape,
            "topic"
                | "process"
                | "decision"
                | "terminator"
                | "client"
                | "frontend"
                | "service"
                | "database"
                | "storage"
                | "queue"
                | "security"
                | "external"
                | "boundary"
        )
        || !node.get("x").is_some_and(finite_number)
        || !node.get("y").is_some_and(finite_number)
        || !node.get("width").is_some_and(finite_number)
        || !node.get("height").is_some_and(finite_number)
    {
        return None;
    }
    let parent_id = match node.get("parentId") {
        Some(Value::String(parent)) if !parent.is_empty() => Some(parent.clone()),
        _ => None,
    };
    Some(SummaryNode {
        id: id.to_owned(),
        label: label.to_owned(),
        shape: shape.to_owned(),
        parent_id,
    })
}

fn parse_edge(value: &Value) -> Option<SummaryEdge> {
    let edge = value.as_object()?;
    let id = edge.get("id")?.as_str()?;
    let source = edge.get("source")?.as_str()?;
    let target = edge.get("target")?.as_str()?;
    if id.is_empty() || source.is_empty() || target.is_empty() {
        return None;
    }
    if let Some(kind) = edge.get("kind") {
        if !matches!(kind.as_str()?, "dependency" | "request" | "async" | "data") {
            return None;
        }
    }
    if edge
        .get("bidirectional")
        .is_some_and(|value| !value.is_boolean())
    {
        return None;
    }
    Some(SummaryEdge {
        source: source.to_owned(),
        target: target.to_owned(),
    })
}

fn preview_labels(kind: &str, nodes: &[SummaryNode]) -> Vec<String> {
    let roots: HashSet<&str> = nodes
        .iter()
        .filter(|node| node.parent_id.is_none())
        .map(|node| node.id.as_str())
        .collect();
    let primary: Vec<&SummaryNode> = if kind == "mind-map" {
        nodes
            .iter()
            .filter(|node| {
                node.parent_id
                    .as_deref()
                    .is_some_and(|parent| roots.contains(parent))
            })
            .collect()
    } else if kind == "architecture" {
        nodes
            .iter()
            .filter(|node| node.shape == "boundary")
            .collect()
    } else {
        Vec::new()
    };
    let candidates: Vec<&SummaryNode> = if primary.is_empty() {
        nodes.iter().collect()
    } else {
        primary
    };
    let mut labels = Vec::new();
    for node in candidates {
        let label = collapse_js_whitespace(&node.label);
        if label.is_empty() || labels.iter().any(|existing: &String| existing == &label) {
            continue;
        }
        labels.push(label);
        if labels.len() == 4 {
            break;
        }
    }
    labels
        .into_iter()
        .map(|label| js_slice(&label, 48))
        .collect()
}

fn table_preview(markdown: &str) -> Option<TablePreview> {
    let value = decode_json(&marker_payload(markdown, "edgeever-table-v1")?)?;
    let document = value.as_object()?;
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    let raw_fields = document.get("fields")?.as_array()?;
    if raw_fields.is_empty() {
        return None;
    }
    let mut field_ids = HashSet::new();
    let mut field_names = Vec::new();
    for field in raw_fields {
        let (id, name) = parse_field(field)?;
        if !field_ids.insert(id) {
            return None;
        }
        if !name.is_empty() {
            field_names.push(name);
        }
    }
    let records = document.get("records")?.as_array()?;
    let mut record_ids = HashSet::new();
    for record in records {
        let record = record.as_object()?;
        let id = record.get("id")?.as_str()?;
        if id.is_empty() || js_len(id) > 80 || !record_ids.insert(id.to_owned()) {
            return None;
        }
    }
    field_names.truncate(4);
    Some(TablePreview {
        field_count: field_ids.len(),
        record_count: records.len(),
        field_names,
    })
}

fn parse_field(value: &Value) -> Option<(String, String)> {
    let field = value.as_object()?;
    let id = field.get("id")?.as_str()?;
    let kind = field.get("type")?.as_str()?;
    if id.is_empty()
        || js_len(id) > 80
        || !matches!(
            kind,
            "text" | "number" | "checkbox" | "date" | "select" | "url" | "attachment"
        )
    {
        return None;
    }
    let raw_name = field.get("name").and_then(Value::as_str).unwrap_or("");
    let collapsed = collapse_js_whitespace(raw_name);
    let name = if collapsed.is_empty() {
        "字段".to_owned()
    } else {
        collapsed
    };
    Some((id.to_owned(), js_slice(&name, 80)))
}

fn finite_number(value: &Value) -> bool {
    value.as_f64().is_some_and(|number| number.is_finite())
}

fn marker_payload(markdown: &str, marker: &str) -> Option<String> {
    let body = first_marker_body(markdown, marker)?;
    let payload = strip_js_whitespace(body);
    if payload.is_empty() || !payload.bytes().all(is_base64url_byte) {
        return None;
    }
    Some(payload)
}

fn first_marker_body<'a>(markdown: &'a str, marker: &str) -> Option<&'a str> {
    let token = format!("{marker}:");
    let mut offset = 0;
    while let Some(relative) = markdown[offset..].find("<!--") {
        let comment = offset + relative + 4;
        let after = trim_js_start(&markdown[comment..]);
        if let Some(body) = after.strip_prefix(&token) {
            let end = body.find("-->")?;
            return Some(trim_js_end(&body[..end]));
        }
        offset = comment;
    }
    None
}

fn infographic_payload(markdown: &str) -> Option<String> {
    let marker = "edgeever-infographic-v1:";
    let mut offset = 0;
    while let Some(relative) = markdown[offset..].find("<!--") {
        let comment = offset + relative + 4;
        let after = trim_js_start(&markdown[comment..]);
        if let Some(body) = after.strip_prefix(marker) {
            let end = body
                .find(|character: char| !is_base64url_char(character))
                .unwrap_or(body.len());
            if end > 0 && trim_js_start(&body[end..]).starts_with("-->") {
                return Some(body[..end].to_string());
            }
        }
        offset = comment;
    }
    None
}

fn decode_json(payload: &str) -> Option<Value> {
    serde_json::from_slice(&decode_base64url(payload)?).ok()
}

fn decode_base64url(input: &str) -> Option<Vec<u8>> {
    if input.len() % 4 == 1 {
        return None;
    }
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3 + 2);
    let mut index = 0;
    while index < bytes.len() {
        let width = (bytes.len() - index).min(4);
        if width < 2 {
            return None;
        }
        let mut chunk = [0u8; 4];
        for slot in 0..width {
            chunk[slot] = base64url_value(bytes[index + slot])?;
        }
        index += width;
        output.push((chunk[0] << 2) | (chunk[1] >> 4));
        if width >= 3 {
            output.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        if width == 4 {
            output.push((chunk[2] << 6) | chunk[3]);
        }
    }
    Some(output)
}

fn base64url_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'-' => Some(62),
        b'_' => Some(63),
        _ => None,
    }
}

fn is_base64url_byte(byte: u8) -> bool {
    base64url_value(byte).is_some()
}

fn is_base64url_char(character: char) -> bool {
    character.is_ascii() && is_base64url_byte(character as u8)
}

fn is_js_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{feff}'
}

fn trim_js_start(value: &str) -> &str {
    value.trim_start_matches(|character: char| is_js_whitespace(character))
}

fn trim_js_end(value: &str) -> &str {
    value.trim_end_matches(|character: char| is_js_whitespace(character))
}

fn strip_js_whitespace(value: &str) -> String {
    value
        .chars()
        .filter(|character| !is_js_whitespace(*character))
        .collect()
}

fn collapse_js_whitespace(value: &str) -> String {
    let mut collapsed = String::new();
    let mut pending_space = false;
    for character in value.chars() {
        if is_js_whitespace(character) {
            if !collapsed.is_empty() {
                pending_space = true;
            }
            continue;
        }
        if pending_space {
            collapsed.push(' ');
            pending_space = false;
        }
        collapsed.push(character);
    }
    collapsed
}

fn js_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn js_slice(value: &str, max_units: usize) -> String {
    let mut units = 0;
    let mut end = 0;
    for (index, character) in value.char_indices() {
        let width = character.len_utf16();
        if units + width > max_units {
            break;
        }
        units += width;
        end = index + character.len_utf8();
    }
    value[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use super::note_list_metadata;

    const INFOGRAPHIC_FIXTURE: &str =
        "eyJzY2hlbWFWZXJzaW9uIjoxLCJzeW50YXgiOiJpbmZvZ3JhcGhpYyBjaGFydC1jb2x1bW4tc2ltcGxlIn0";
    const INFOGRAPHIC_HISTORY_FIXTURE: &str = "eyJzY2hlbWFWZXJzaW9uIjoxLCJzeW50YXgiOiLlraPluqYiLCJoaXN0b3J5IjpbeyJpZCI6Im9uZSIsInByb21wdCI6IuaNouaIkOWwj-exsyIsImNyZWF0ZWRBdCI6IjIwMjYtMTAtMDJUMDA6Mzc6MDAuMDAwWiIsImtpbmQiOiJyZWZpbmVkIiwicmVzdWx0VGl0bGUiOiLokKXmlLYiLCJyZXNwb25zZSI6IuW3suabv-aNouOAgiJ9XX0";

    fn wrap(marker: &str, payload: &str) -> String {
        format!("readable fallback\n\n<!-- {marker}:{payload} -->")
    }

    #[test]
    fn plain_and_broken_notes_stay_ordinary() {
        for markdown in [
            "ordinary note",
            "<!-- edgeever-infographic-v1:broken -->",
            "<!-- edgeever-diagram-v1:broken -->",
            "<!-- edgeever-table-v1:not-json -->",
        ] {
            let metadata = note_list_metadata(markdown);
            assert_eq!(
                metadata["diagramKind"],
                serde_json::Value::Null,
                "{markdown}"
            );
            assert!(metadata.get("diagramPreview").is_none(), "{markdown}");
            assert_eq!(metadata["infographic"], false, "{markdown}");
            assert_eq!(metadata["structuredTable"], false, "{markdown}");
            assert!(metadata.get("tablePreview").is_none(), "{markdown}");
        }
    }

    #[test]
    fn infographic_marker_from_js_base64_is_recognized_with_history() {
        assert_eq!(
            note_list_metadata(&wrap("edgeever-infographic-v1", INFOGRAPHIC_FIXTURE))
                ["infographic"],
            true
        );
        assert_eq!(
            note_list_metadata(&wrap(
                "edgeever-infographic-v1",
                INFOGRAPHIC_HISTORY_FIXTURE
            ))["infographic"],
            true
        );
        let broken_history = wrap(
            "edgeever-infographic-v1",
            &encode_json(
                r#"{"schemaVersion":1,"syntax":"ok","history":[{"id":"one","prompt":42,"createdAt":"2026-10-02T00:00:00.000Z","kind":"refined","resultTitle":""}]}"#,
            ),
        );
        assert_eq!(note_list_metadata(&broken_history)["infographic"], false);
    }

    #[test]
    fn diagram_preview_uses_child_topics_and_ignores_a_wrapped_payload() {
        let payload = encode_json(
            r#"{"schemaVersion":1,"kind":"mind-map","nodes":[{"id":"root","label":"根","x":0,"y":0,"width":1,"height":1,"shape":"topic"},{"id":"child","label":"  分支  主题  ","x":1,"y":1,"width":1,"height":1,"shape":"topic","parentId":"root"}],"edges":[{"id":"edge","source":"root","target":"child"}]}"#,
        );
        let wrapped = format!("<!-- edgeever-diagram-v1:\n{payload}\n-->");
        let metadata = note_list_metadata(&wrapped);
        assert_eq!(metadata["diagramKind"], "mind-map");
        assert_eq!(metadata["diagramPreview"]["nodeCount"], 2);
        assert_eq!(metadata["diagramPreview"]["edgeCount"], 1);
        assert_eq!(
            metadata["diagramPreview"]["labels"],
            serde_json::json!(["分支 主题"])
        );
        assert_eq!(metadata["infographic"], false);
    }

    #[test]
    fn table_preview_counts_fields_and_records() {
        let payload = encode_json(
            r#"{"schemaVersion":1,"fields":[{"id":"fld_name","name":" 名称 ","type":"text"},{"id":"fld_status","name":"","type":"select"}],"records":[{"id":"rec_1","cells":{}}]}"#,
        );
        let metadata = note_list_metadata(&wrap("edgeever-table-v1", &payload));
        assert_eq!(metadata["structuredTable"], true);
        assert_eq!(metadata["tablePreview"]["fieldCount"], 2);
        assert_eq!(metadata["tablePreview"]["recordCount"], 1);
        assert_eq!(
            metadata["tablePreview"]["fieldNames"],
            serde_json::json!(["名称", "字段"])
        );
        assert!(metadata.get("contentMarkdown").is_none());
    }

    fn encode_json(json: &str) -> String {
        encode_base64url(json.as_bytes())
    }

    fn encode_base64url(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut encoded = String::new();
        let mut index = 0;
        while index + 3 <= bytes.len() {
            let chunk = ((bytes[index] as u32) << 16)
                | ((bytes[index + 1] as u32) << 8)
                | bytes[index + 2] as u32;
            encoded.push(ALPHABET[((chunk >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((chunk >> 12) & 63) as usize] as char);
            encoded.push(ALPHABET[((chunk >> 6) & 63) as usize] as char);
            encoded.push(ALPHABET[(chunk & 63) as usize] as char);
            index += 3;
        }
        let rest = &bytes[index..];
        if rest.len() == 1 {
            let chunk = (rest[0] as u32) << 16;
            encoded.push(ALPHABET[((chunk >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((chunk >> 12) & 63) as usize] as char);
        } else if rest.len() == 2 {
            let chunk = ((rest[0] as u32) << 16) | ((rest[1] as u32) << 8);
            encoded.push(ALPHABET[((chunk >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((chunk >> 12) & 63) as usize] as char);
            encoded.push(ALPHABET[((chunk >> 6) & 63) as usize] as char);
        }
        encoded
    }
}
