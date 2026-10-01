
import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";

function QCRecords() {
  const [records, setRecords] = useState([]);
  const [studyId, setStudyId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");

  async function loadRecords() {
    try {
      const data = await apiRequest("/qc");
      setRecords(data);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    loadRecords();
  }, []);

  async function addRecord(e) {
    e.preventDefault();
    setMessage("");

    try {
      await apiRequest("/qc", {
        method: "POST",
        body: JSON.stringify({
          study_id: studyId,
          status: "Pending",
          remarks,
        }),
      });

      setStudyId("");
      setRemarks("");
      setMessage("Record added successfully.");

      await loadRecords();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <>
      <h1>QC Records</h1>
      <p>Manage study quality-control records.</p>

      <div className="panel">
        <h3>Add QC Record</h3>

        <form onSubmit={addRecord}>
          <input
            placeholder="Study ID"
            value={studyId}
            onChange={(e) => setStudyId(e.target.value)}
            required
          />

          <input
            placeholder="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />

          <button type="submit">Add Record</button>
        </form>

        {message && <p>{message}</p>}
      </div>

      <div className="panel">
        <h3>Existing Records</h3>

        <table border="1" cellPadding="8">
          <thead>
            <tr>
              <th>ID</th>
              <th>Study ID</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>

          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.id}</td>
                <td>{record.study_id}</td>
                <td>{record.status}</td>
                <td>{record.remarks || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default QCRecords;