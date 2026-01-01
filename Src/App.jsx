
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Calendar, Plus, Trash2, Download, Zap, AlertCircle, CheckCircle } from 'lucide-react';

const supabase = createClient(
  'https://vazeghxypxjcjuzdqxxz.supabase.co',
  'sb_publishable_-brj5ZLmfJBWXFE9WNdJGw_e83hsmob'
);

export default function SchedoX() {
  const [activeTab, setActiveTab] = useState('setup');
  const [university, setUniversity] = useState(null);
  const [faculties, setFaculties] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [venues, setVenues] = useState([]);
  const [courses, setCourses] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [autoScheduleResults, setAutoScheduleResults] = useState(null);

  useEffect(() => {
    loadUniversity();
    loadTimeSlots();
  }, []);

  useEffect(() => {
    if (university) {
      loadFaculties();
      loadLecturers();
      loadVenues();
    }
  }, [university]);

  useEffect(() => {
    if (faculties.length > 0) {
      loadDepartments();
    }
  }, [faculties]);

  useEffect(() => {
    if (departments.length > 0) {
      loadCourses();
      loadSessions();
    }
  }, [departments]);

  async function loadUniversity() {
    const { data } = await supabase.from('universities').select('*').limit(1).single();
    if (data) {
      setUniversity(data);
    } else {
      const { data: newUni } = await supabase
        .from('universities')
        .insert({ name: 'My University' })
        .select()
        .single();
      setUniversity(newUni);
    }
  }

  async function loadFaculties() {
    const { data } = await supabase
      .from('faculties')
      .select('*')
      .eq('university_id', university.id);
    setFaculties(data || []);
  }

  async function loadDepartments() {
    const { data } = await supabase
      .from('departments')
      .select('*, faculties(name)')
      .in('faculty_id', faculties.map(f => f.id));
    setDepartments(data || []);
  }

  async function loadLecturers() {
    const { data } = await supabase
      .from('lecturers')
      .select('*, departments(name)')
      .eq('university_id', university.id);
    setLecturers(data || []);
  }

  async function loadVenues() {
    const { data } = await supabase
      .from('venues')
      .select('*')
      .eq('university_id', university.id);
    setVenues(data || []);
  }

  async function loadCourses() {
    const { data } = await supabase
      .from('courses')
      .select('*, departments(name), lecturers(name)')
      .in('department_id', departments.map(d => d.id));
    setCourses(data || []);
  }

  async function loadTimeSlots() {
    const { data } = await supabase.from('time_slots').select('*').order('day').order('period');
    setTimeSlots(data || []);
  }

  async function loadSessions() {
    const { data } = await supabase
      .from('schedule_sessions')
      .select('*, courses(code, title), venues(name), time_slots(day, period, start_time)');
    setSessions(data || []);
  }

  async function addFaculty(name) {
    const { data } = await supabase
      .from('faculties')
      .insert({ university_id: university.id, name })
      .select()
      .single();
    setFaculties([...faculties, data]);
  }

  async function addDepartment(facultyId, name) {
    const { data } = await supabase
      .from('departments')
      .insert({ faculty_id: facultyId, name })
      .select('*, faculties(name)')
      .single();
    setDepartments([...departments, data]);
  }

  async function addLecturer(name, email, departmentId) {
    const { data } = await supabase
      .from('lecturers')
      .insert({ university_id: university.id, name, email, department_id: departmentId })
      .select('*, departments(name)')
      .single();
    setLecturers([...lecturers, data]);
  }

  async function addVenue(name, capacity, type, building) {
    const { data } = await supabase
      .from('venues')
      .insert({ university_id: university.id, name, capacity, type, building })
      .select()
      .single();
    setVenues([...venues, data]);
  }

  async function addCourse(courseData) {
    const { data } = await supabase
      .from('courses')
      .insert(courseData)
      .select('*, departments(name), lecturers(name)')
      .single();
    setCourses([...courses, data]);
  }

  async function autoSchedule() {
    const unscheduled = courses.filter(
      c => !sessions.find(s => s.course_id === c.id)
    );

    if (unscheduled.length === 0) {
      alert('All courses already scheduled!');
      return;
    }

    const results = { scheduled: [], failed: [] };

    for (const course of unscheduled) {
      const scored = scoreAllSlots(course);
      const best = scored[0];

      if (best && best.score > 50) {
        const { data } = await supabase
          .from('schedule_sessions')
          .insert({
            course_id: course.id,
            venue_id: best.venue.id,
            time_slot_id: best.slot.id,
            status: 'draft'
          })
          .select('*, courses(code), venues(name), time_slots(day, period)')
          .single();

        if (data) {
          results.scheduled.push({ course, session: data });
        }
      } else {
        results.failed.push({
          course,
          reason: best ? `Low score: ${best.score}` : 'No valid slots'
        });
      }
    }

    await loadSessions();
    setAutoScheduleResults(results);
  }

  function scoreAllSlots(course) {
    const scored = [];

    for (const slot of timeSlots) {
      for (const venue of venues) {
        if (course.venue_type_needed && venue.type !== course.venue_type_needed) continue;

        let score = 100;

        const lecturerClash = sessions.find(
          s => s.courses?.lecturer_id === course.lecturer_id && s.time_slot_id === slot.id
        );
        if (lecturerClash) continue;

        const venueClash = sessions.find(
          s => s.venue_id === venue.id && s.time_slot_id === slot.id
        );
        if (venueClash) continue;

        if (course.estimated_enrollment > venue.capacity) {
          score -= 50;
        }

        if (slot.period <= 2) score += 15;
        if (venue.capacity >= course.estimated_enrollment * 1.2) score += 10;

        scored.push({ slot, venue, score });
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  async function deleteSession(sessionId) {
    await supabase.from('schedule_sessions').delete().eq('id', sessionId);
    await loadSessions();
  }

  function renderSetup() {
    return (
      <div className="space-y-6">
        <SetupSection
          title="Faculties"
          items={faculties}
          onAdd={(name) => addFaculty(name)}
          placeholder="e.g., Science"
        />
        <SetupSection
          title="Departments"
          items={departments.map(d => ({ ...d, display: `${d.name} (${d.faculties?.name})` }))}
          onAdd={(name) => {
            if (faculties.length === 0) {
              alert('Add a faculty first!');
              return;
            }
            const facultyId = faculties[0].id;
            addDepartment(facultyId, name);
          }}
          placeholder="e.g., Computer Science"
        />
        <SetupSection
          title="Lecturers"
          items={lecturers.map(l => ({ ...l, display: `${l.name} (${l.departments?.name || 'No dept'})` }))}
          onAdd={(name) => {
            const email = prompt('Email (optional):');
            if (departments.length === 0) {
              alert('Add a department first!');
              return;
            }
            addLecturer(name, email, departments[0].id);
          }}
          placeholder="e.g., Dr. Ahmed Ibrahim"
        />
        <SetupSection
          title="Venues"
          items={venues.map(v => ({ ...v, display: `${v.name} (Cap: ${v.capacity}, ${v.type})` }))}
          onAdd={(name) => {
            const capacity = parseInt(prompt('Capacity:') || '0');
            const type = prompt('Type (Lecture Hall/Lab):') || 'Lecture Hall';
            const building = prompt('Building (optional):');
            addVenue(name, capacity, type, building);
          }}
          placeholder="e.g., LT1"
        />
      </div>
    );
  }

  function renderCourses() {
    return (
      <div className="space-y-4">
        <button
          onClick={() => {
            const code = prompt('Course Code:');
            const title = prompt('Course Title:');
            const level = parseInt(prompt('Level (100/200/300/400):') || '100');
            const semester = prompt('Semester (first/second):') || 'first';
            const units = parseInt(prompt('Units:') || '3');
            
            if (!code || !title) return;
            
            if (departments.length === 0) {
              alert('Add departments first!');
              return;
            }

            addCourse({
              department_id: departments[0].id,
              code,
              title,
              level,
              semester,
              units,
              lecturer_id: lecturers.length > 0 ? lecturers[0].id : null,
              estimated_enrollment: 50,
              venue_type_needed: 'Lecture Hall'
            });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Course
        </button>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Code</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Title</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Level</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Lecturer</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {courses.map(course => {
                const scheduled = sessions.find(s => s.course_id === course.id);
                return (
                  <tr key={course.id}>
                    <td className="px-4 py-3 text-sm font-mono">{course.code}</td>
                    <td className="px-4 py-3 text-sm">{course.title}</td>
                    <td className="px-4 py-3 text-sm">{course.level}</td>
                    <td className="px-4 py-3 text-sm">{course.lecturers?.name || 'TBD'}</td>
                    <td className="px-4 py-3 text-sm">
                      {scheduled ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" />
                          Scheduled
                        </span>
                      ) : (
                        <span className="text-yellow-600">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderSchedule() {
    const scheduledCount = sessions.length;
    const totalCount = courses.length;

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Schedule Builder</h2>
              <p className="opacity-90">
                {scheduledCount} of {totalCount} courses scheduled
                ({totalCount > 0 ? Math.round((scheduledCount / totalCount) * 100) : 0}%)
              </p>
            </div>
            <button
              onClick={autoSchedule}
              disabled={scheduledCount === totalCount}
              className="flex items-center gap-2 px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Zap className="w-5 h-5" />
              Auto-Schedule
            </button>
          </div>
        </div>

        {autoScheduleResults && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-bold mb-4">Auto-Schedule Results</h3>
            <div className="space-y-4">
              {autoScheduleResults.scheduled.length > 0 && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-green-600">
                      {autoScheduleResults.scheduled.length} courses scheduled successfully
                    </p>
                  </div>
                </div>
              )}
              {autoScheduleResults.failed.length > 0 && (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-yellow-600 mb-2">
                      {autoScheduleResults.failed.length} courses need manual placement:
                    </p>
                    <ul className="text-sm space-y-1 ml-4">
                      {autoScheduleResults.failed.map((f, i) => (
                        <li key={i}>
                          {f.course.code}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Day</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Time</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Course</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Venue</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sessions.map(session => (
                  <tr key={session.id}>
                    <td className="px-4 py-3 text-sm">{session.time_slots?.day}</td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {session.time_slots?.start_time?.substring(0, 5)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium">{session.courses?.code}</div>
                      <div className="text-gray-500 text-xs">{session.courses?.title}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">{session.venues?.name}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteSession(session.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">SchedoX</h1>
                <p className="text-sm text-gray-600">Semi-Auto Timetable Scheduling</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-6">
            {['setup', 'courses', 'schedule'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-1 border-b-2 font-medium text-sm capitalize transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'setup' && renderSetup()}
        {activeTab === 'courses' && renderCourses()}
        {activeTab === 'schedule' && renderSchedule()}
      </main>
    </div>
  );
}

function SetupSection({ title, items, onAdd, placeholder }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      onAdd(input.trim());
      setInput('');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-bold mb-4">{title}</h3>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-sm">{item.display || item.name}</span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-4">No {title.toLowerCase()} added yet</p>
        )}
      </div>
    </div>
  );
}
